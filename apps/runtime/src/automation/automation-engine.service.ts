import { randomUUID } from 'node:crypto';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, type ExecutionStep } from '@prisma/client';
import { Queue } from 'bullmq';
import { AutomationDefinitionSchema } from '@nexo/contracts';
import { PrismaService } from '../infra/prisma.service.js';
import { RedisService } from '../infra/redis.service.js';
import { menuOptions, menuTimeoutSeconds, renderTemplate, resolveMenuChoice, routesByChoice, selectNextEdge, selectPortEdge, setContextPath, type AutomationDefinition, type AutomationNode } from './routing.js';
import { integrationOutcome, parseResponseFields } from './integration.js';
import { liveConditionContext, mergeLiveContext } from './live-context.js';
import { buildAiMessages, callOpenAi, resolveOpenAiKey } from './ai-call.js';
import { FieldCipher } from '../crypto/field-cipher.js';
import { loadConfig } from '../config.js';
import { AgentRuntimeService } from '../agent/agent-runtime.service.js';

const AUTOMATION_QUEUE = 'automation.execute';
const RELEASE_LOCK = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
const outcomeTypes = new Set(['QUALIFIED', 'APPOINTMENT', 'SALE', 'RESOLVED', 'HANDOFF', 'DISQUALIFIED']);

export type AutomationJob = { executionId: string; action?: 'start' | 'resume' | 'menu_reply' | 'menu_timeout'; resumeStepId?: string; messageId?: string };
type PendingMenu = { stepId: string; nodeId: string };
type RuntimeState = { pendingDelayStepId?: string; pendingMenu?: PendingMenu; error?: { code: string; message: string } };
type EngineContext = Record<string, unknown> & { _runtime?: RuntimeState };

class NodeExecutionError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

const asJson = (value: unknown) => value as Prisma.InputJsonValue;
const objectContext = (value: Prisma.JsonValue): EngineContext => value && typeof value === 'object' && !Array.isArray(value) ? value as EngineContext : {};
const stringConfig = (node: AutomationNode, key: string) => {
  const value = node.config[key];
  if (typeof value !== 'string' || !value.trim()) throw new NodeExecutionError('INVALID_NODE_CONFIG', `O nó ${node.id} requer config.${key}.`);
  return value.trim();
};
@Injectable()
export class AutomationEngineService implements OnModuleDestroy {
  private readonly queue: Queue<AutomationJob>;
  private readonly cipher = new FieldCipher(loadConfig().encryptionKey);

  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService, private readonly agents: AgentRuntimeService) {
    this.queue = new Queue<AutomationJob>(AUTOMATION_QUEUE, { connection: this.redis });
  }

  async execute(job: AutomationJob): Promise<void> {
    const lockKey = `automation:lock:${job.executionId}`;
    const token = randomUUID();
    if (await this.redis.set(lockKey, token, 'PX', 120_000, 'NX') !== 'OK') throw new Error(`Execution ${job.executionId} is already being processed`);
    try {
      await this.executeLocked(job);
    } finally {
      await this.redis.eval(RELEASE_LOCK, 1, lockKey, token);
    }
  }

  private async executeLocked(job: AutomationJob) {
    const execution = await this.loadExecution(job.executionId);
    if (!execution || ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(execution.status)) return;
    let context = objectContext(execution.context);
    if (execution.status === 'WAITING') {
      const pending = context._runtime;
      const delayDue = job.action === 'resume' && Boolean(job.resumeStepId) && pending?.pendingDelayStepId === job.resumeStepId;
      const menuDue = (job.action === 'menu_reply' || job.action === 'menu_timeout') && Boolean(job.resumeStepId) && pending?.pendingMenu?.stepId === job.resumeStepId;
      if (!delayDue && !menuDue) return;
    }

    const parsed = AutomationDefinitionSchema.safeParse(execution.playbookVersion.definition);
    if (!parsed.success) {
      await this.failExecution(execution.id, 'INVALID_DEFINITION', parsed.error.message);
      return;
    }
    const definition = parsed.data;
    const nodes = new Map(definition.nodes.map(node => [node.id, node]));
    let currentNodeId: string | undefined = execution.currentNode ?? definition.start;

    if (execution.status === 'WAITING') {
      const pendingMenu = context._runtime?.pendingMenu;
      if (pendingMenu) {
        const resumed = await this.resumeMenu(execution.id, execution.conversationId, job, pendingMenu, context, definition);
        if (!resumed) return;
        context = resumed.context;
        currentNodeId = resumed.nextNodeId;
      } else {
        context = { ...context, _runtime: {} };
      }
      await this.prisma.execution.update({ where: { id: execution.id }, data: { status: 'RUNNING', currentNode: currentNodeId, context: asJson(context) } });
    }
    const previousSteps = await this.prisma.executionStep.count({ where: { executionId: execution.id, status: 'SUCCEEDED' } });
    let processed = previousSteps;

    while (currentNodeId) {
      if (processed >= definition.settings.maxSteps) {
        await this.failExecution(execution.id, 'MAX_STEPS_EXCEEDED', `A execução excedeu ${definition.settings.maxSteps} passos.`);
        return;
      }
      const latest = await this.prisma.execution.findUnique({ where: { id: execution.id }, select: { status: true, context: true } });
      if (!latest || latest.status === 'CANCELLED') return;
      context = objectContext(latest.context);
      const node = nodes.get(currentNodeId);
      if (!node) {
        await this.failExecution(execution.id, 'NODE_NOT_FOUND', `Nó ${currentNodeId} não encontrado.`);
        return;
      }
      if (node.kind === 'condition') context = mergeLiveContext(context, await this.loadLiveContext(execution.workspaceId, execution.conversationId));
      const edge = selectNextEdge(node, definition.edges, context);
      const nextNodeId = edge?.target;
      let routedNodeId: string | undefined = nextNodeId;
      let step = await this.prisma.executionStep.findFirst({ where: { executionId: execution.id, nodeId: node.id, status: 'RUNNING' }, orderBy: { startedAt: 'desc' } });
      step ??= await this.prisma.executionStep.create({ data: { executionId: execution.id, nodeId: node.id, kind: node.kind, status: 'RUNNING', input: asJson({ context, selectedEdgeId: edge?.id ?? null }) } });
      try {
        const result = await this.runNode({ executionId: execution.id, workspaceId: execution.workspaceId, conversationId: execution.conversationId, context, definition, node, step, nextNodeId });
        if (result === 'waiting' || result === 'terminal') return;
        if (typeof result === 'object') routedNodeId = result.next;
      } catch (error) {
        const code = error instanceof NodeExecutionError ? error.code : 'NODE_EXECUTION_FAILED';
        const message = error instanceof Error ? error.message : 'Falha desconhecida durante a execução do nó.';
        await this.prisma.$transaction([
          this.prisma.executionStep.update({ where: { id: step.id }, data: { status: 'FAILED', reason: `${code}: ${message}`.slice(0, 1000), finishedAt: new Date() } }),
          this.prisma.execution.update({ where: { id: execution.id }, data: { status: 'FAILED', currentNode: node.id, finishedAt: new Date() } })
        ]);
        throw error;
      }
      processed += 1;
      currentNodeId = routedNodeId;
      if (!currentNodeId) {
        await this.failExecution(execution.id, 'DEAD_END', `O nó ${node.id} não possui uma saída válida.`);
        return;
      }
    }
  }

  private async runNode(input: {
    executionId: string;
    workspaceId: string;
    conversationId: string;
    context: EngineContext;
    definition: AutomationDefinition;
    node: AutomationNode;
    step: ExecutionStep;
    nextNodeId?: string;
  }): Promise<'continue' | 'waiting' | 'terminal' | { next: string }> {
    const { executionId, workspaceId, conversationId, context, node, step, nextNodeId } = input;
    const waitsForChoice = routesByChoice(node, input.definition.edges);
    if (!['handoff', 'outcome'].includes(node.kind) && !nextNodeId && !waitsForChoice) throw new NodeExecutionError('DEAD_END', `O nó ${node.id} não possui uma saída válida.`);

    switch (node.kind) {
      case 'trigger':
      case 'condition':
        await this.completeStep(executionId, step.id, nextNodeId, context, { selectedTarget: nextNodeId });
        return 'continue';

      case 'message': {
        const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId }, include: { channel: true } });
        if (!conversation || conversation.workspaceId !== workspaceId) throw new NodeExecutionError('CONVERSATION_NOT_FOUND', 'A conversa da execução não existe.');
        if (conversation.channel.provider !== 'baileys' || conversation.channel.status !== 'CONNECTED') throw new NodeExecutionError('CHANNEL_UNAVAILABLE', 'O canal Baileys precisa estar conectado para enviar a mensagem.');
        const body = renderTemplate(stringConfig(node, 'text'), context);
        if (!body.trim()) throw new NodeExecutionError('EMPTY_MESSAGE', 'A mensagem ficou vazia após a interpolação.');
        await this.prisma.$transaction(async tx => {
          const message = await tx.message.create({ data: { workspaceId, conversationId, direction: 'OUTBOUND', type: 'TEXT', status: 'PENDING', body, authorType: 'automation', authorId: executionId } });
          await tx.outboxEvent.create({ data: { workspaceId, aggregate: 'Message', aggregateId: message.id, type: 'message.send.requested', payload: { messageId: message.id } } });
          await tx.executionStep.update({ where: { id: step.id }, data: { status: 'SUCCEEDED', output: { messageId: message.id }, finishedAt: new Date() } });
          await tx.execution.update({ where: { id: executionId }, data: { currentNode: nextNodeId, context: asJson(context) } });
        });
        return 'continue';
      }

      case 'image':
      case 'audio':
      case 'sticker':
      case 'buttons': {
        const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId }, include: { channel: true } });
        if (!conversation || conversation.workspaceId !== workspaceId) throw new NodeExecutionError('CONVERSATION_NOT_FOUND', 'A conversa da execução não existe.');
        if (conversation.channel.provider !== 'baileys' || conversation.channel.status !== 'CONNECTED') throw new NodeExecutionError('CHANNEL_UNAVAILABLE', 'O canal Baileys precisa estar conectado para enviar a mensagem.');
        // Menus carry an optional header image (buttons format only); media blocks require one.
        const urlValue = node.kind === 'buttons' ? (node.config.mode === 'list' ? undefined : node.config.imageUrl) : node.config.url;
        const rawUrl = typeof urlValue === 'string' ? renderTemplate(urlValue, context).trim() : '';
        if ((node.kind !== 'buttons' || rawUrl) && !rawUrl.startsWith('https://')) throw new NodeExecutionError('MEDIA_HTTPS_REQUIRED', 'A mídia precisa usar uma URL HTTPS.');
        const body = node.kind === 'image'
          ? (typeof node.config.caption === 'string' ? renderTemplate(node.config.caption, context) : null)
          : node.kind === 'buttons' ? renderTemplate(stringConfig(node, 'text'), context) : null;
        const buttons = node.kind === 'buttons' && Array.isArray(node.config.buttons)
          ? node.config.buttons.map(item => {
              const button = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
              return {
                id: typeof button.id === 'string' ? button.id : '',
                label: typeof button.label === 'string' ? renderTemplate(button.label, context) : '',
                ...(typeof button.description === 'string' && button.description.trim() ? { description: renderTemplate(button.description, context) } : {})
              };
            })
          : undefined;
        const messageType = node.kind === 'audio' ? 'AUDIO' : node.kind === 'buttons' ? 'TEMPLATE' : 'IMAGE';
        const providerPayload = node.kind === 'buttons'
          ? {
              kind: 'buttons', mode: node.config.mode === 'list' ? 'list' : 'buttons', buttons,
              ...(typeof node.config.footer === 'string' && node.config.footer.trim() ? { footer: renderTemplate(node.config.footer, context) } : {}),
              ...(typeof node.config.buttonText === 'string' && node.config.buttonText.trim() ? { buttonText: renderTemplate(node.config.buttonText, context) } : {})
            }
          : node.kind === 'sticker' ? { kind: 'sticker' }
          : node.kind === 'audio' ? { kind: 'audio', ptt: node.config.ptt === true }
          : { kind: 'image' };
        await this.prisma.$transaction(async tx => {
          const message = await tx.message.create({ data: { workspaceId, conversationId, direction: 'OUTBOUND', type: messageType, status: 'PENDING', body, mediaUrl: rawUrl || null, providerPayload: asJson(providerPayload), authorType: 'automation', authorId: executionId } });
          await tx.outboxEvent.create({ data: { workspaceId, aggregate: 'Message', aggregateId: message.id, type: 'message.send.requested', payload: { messageId: message.id } } });
          if (!waitsForChoice) {
            await this.finishInTransaction(tx, executionId, step.id, nextNodeId, context, { messageId: message.id, kind: node.kind });
            return;
          }
          // The step stays RUNNING until the contact answers or the menu expires.
          const pendingMenu: PendingMenu = { stepId: step.id, nodeId: node.id };
          await tx.executionStep.update({ where: { id: step.id }, data: { output: asJson({ messageId: message.id, kind: node.kind, waitingForReply: true }) } });
          await tx.execution.update({ where: { id: executionId }, data: { status: 'WAITING', currentNode: node.id, context: asJson({ ...context, _runtime: { pendingMenu } }) } });
        });
        if (!waitsForChoice) return 'continue';
        try {
          await this.queue.add('menu_timeout', { executionId, action: 'menu_timeout', resumeStepId: step.id }, { jobId: `automation-menu-timeout-${executionId}-${step.id}`, delay: menuTimeoutSeconds(node) * 1000, attempts: 5, backoff: { type: 'exponential', delay: 1_000 }, removeOnComplete: 1_000, removeOnFail: 5_000 });
        } catch (error) {
          await this.failExecution(executionId, 'MENU_TIMEOUT_SCHEDULING_FAILED', error instanceof Error ? error.message : 'Não foi possível agendar a expiração do menu.');
          throw error;
        }
        return 'waiting';
      }

      case 'delay': {
        const seconds = node.config.seconds;
        if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 1 || seconds > 2_678_400) throw new NodeExecutionError('INVALID_DELAY', 'A espera deve ter entre 1 segundo e 31 dias.');
        const waitingContext: EngineContext = { ...context, _runtime: { pendingDelayStepId: step.id } };
        await this.prisma.$transaction([
          this.prisma.executionStep.update({ where: { id: step.id }, data: { status: 'SUCCEEDED', output: { delaySeconds: seconds, resumeAt: new Date(Date.now() + seconds * 1000).toISOString() }, finishedAt: new Date() } }),
          this.prisma.execution.update({ where: { id: executionId }, data: { status: 'WAITING', currentNode: nextNodeId, context: asJson(waitingContext) } })
        ]);
        try {
          await this.queue.add('resume', { executionId, action: 'resume', resumeStepId: step.id }, { jobId: `automation-resume-${executionId}-${step.id}`, delay: seconds * 1000, attempts: 5, backoff: { type: 'exponential', delay: 1_000 }, removeOnComplete: 1_000, removeOnFail: 5_000 });
        } catch (error) {
          await this.failExecution(executionId, 'DELAY_SCHEDULING_FAILED', error instanceof Error ? error.message : 'Não foi possível agendar a retomada.');
          throw error;
        }
        return 'waiting';
      }

      case 'assign': {
        const assigneeId = typeof node.config.assigneeId === 'string' ? node.config.assigneeId : undefined;
        const queue = typeof node.config.queue === 'string' ? node.config.queue.trim() : undefined;
        if (!assigneeId && !queue) throw new NodeExecutionError('ASSIGN_TARGET_REQUIRED', 'Informe um responsável ou fila.');
        if (assigneeId && !await this.prisma.membership.count({ where: { workspaceId, userId: assigneeId } })) throw new NodeExecutionError('INVALID_ASSIGNEE', 'O responsável não pertence ao workspace.');
        await this.prisma.$transaction(async tx => {
          await tx.conversation.update({ where: { id: conversationId }, data: { assigneeId, queue } });
          await this.finishInTransaction(tx, executionId, step.id, nextNodeId, context, { assigneeId, queue });
        });
        return 'continue';
      }

      case 'tag': {
        const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { contactId: true } });
        if (!conversation) throw new NodeExecutionError('CONVERSATION_NOT_FOUND', 'A conversa da execução não existe.');
        const mode = node.config.mode === 'remove' ? 'remove' : 'add';
        const configuredIds = Array.isArray(node.config.tagIds) ? node.config.tagIds.filter((value): value is string => typeof value === 'string' && Boolean(value)) : [];
        if (typeof node.config.tagId === 'string' && node.config.tagId) configuredIds.push(node.config.tagId);
        const configuredNames = Array.isArray(node.config.tags) ? node.config.tags.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map(value => value.trim()) : [];
        if (typeof node.config.tag === 'string' && node.config.tag.trim()) configuredNames.push(node.config.tag.trim());
        if (!configuredIds.length && !configuredNames.length) throw new NodeExecutionError('TAG_REQUIRED', 'Informe ao menos uma etiqueta.');
        await this.prisma.$transaction(async tx => {
          const uniqueIds = [...new Set(configuredIds)];
          if (uniqueIds.length && await tx.tag.count({ where: { id: { in: uniqueIds }, workspaceId } }) !== uniqueIds.length) throw new NodeExecutionError('TAG_NOT_FOUND', 'Uma ou mais etiquetas configuradas não existem.');
          for (const name of [...new Set(configuredNames)]) {
            const tag = mode === 'add'
              ? await tx.tag.upsert({ where: { workspaceId_name: { workspaceId, name } }, create: { workspaceId, name }, update: {} })
              : await tx.tag.findUnique({ where: { workspaceId_name: { workspaceId, name } } });
            if (tag) uniqueIds.push(tag.id);
          }
          const tagIds = [...new Set(uniqueIds)];
          if (mode === 'remove') await tx.contactTag.deleteMany({ where: { contactId: conversation.contactId, tagId: { in: tagIds } } });
          else for (const tagId of tagIds) {
            const alreadyTagged = await tx.contactTag.count({ where: { contactId: conversation.contactId, tagId } });
            await tx.contactTag.upsert({ where: { contactId_tagId: { contactId: conversation.contactId, tagId } }, create: { contactId: conversation.contactId, tagId }, update: {} });
            if (!alreadyTagged) await tx.outboxEvent.create({ data: { workspaceId, aggregate: 'Contact', aggregateId: conversation.contactId, type: 'automation.trigger.requested', payload: { event: 'tag.added', conversationId, contactId: conversation.contactId, tagId } } });
          }
          await this.finishInTransaction(tx, executionId, step.id, nextNodeId, context, { mode, tagIds });
        });
        return 'continue';
      }

      case 'handoff': {
        const reason = typeof node.config.reason === 'string' ? renderTemplate(node.config.reason, context) : 'Handoff solicitado pela automação.';
        const queue = typeof node.config.queue === 'string' ? node.config.queue : undefined;
        await this.prisma.$transaction(async tx => {
          await tx.conversation.update({ where: { id: conversationId }, data: { mode: 'HUMAN', status: 'QUEUED', queue } });
          await tx.executionStep.update({ where: { id: step.id }, data: { status: 'SUCCEEDED', output: { handoff: true, reason, queue }, finishedAt: new Date() } });
          await tx.execution.update({ where: { id: executionId }, data: { status: 'SUCCEEDED', currentNode: node.id, context: asJson(context), finishedAt: new Date() } });
        });
        return 'terminal';
      }

      case 'outcome': {
        const type = node.config.type;
        if (typeof type !== 'string' || !outcomeTypes.has(type)) throw new NodeExecutionError('OUTCOME_TYPE_REQUIRED', 'Configure um tipo de desfecho válido.');
        const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { contactId: true } });
        if (!conversation) throw new NodeExecutionError('CONVERSATION_NOT_FOUND', 'A conversa da execução não existe.');
        const valueCents = typeof node.config.valueCents === 'number' && Number.isInteger(node.config.valueCents) ? node.config.valueCents : undefined;
        await this.prisma.$transaction(async tx => {
          await tx.outcome.create({ data: { workspaceId, conversationId, contactId: conversation.contactId, type: type as never, valueCents, metadata: asJson({ executionId, nodeId: node.id }) } });
          if (type === 'RESOLVED') await tx.conversation.update({ where: { id: conversationId }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
          await tx.executionStep.update({ where: { id: step.id }, data: { status: 'SUCCEEDED', output: { type, valueCents }, finishedAt: new Date() } });
          await tx.execution.update({ where: { id: executionId }, data: { status: 'SUCCEEDED', currentNode: node.id, context: asJson(context), finishedAt: new Date() } });
        });
        return 'terminal';
      }

      case 'ai': {
        const config = node.config;
        const latest = await this.prisma.message.findFirst({ where: { workspaceId, conversationId, direction: 'INBOUND' }, orderBy: { createdAt: 'desc' } });
        let aiContext: EngineContext = { ...context, last_message: latest?.body ?? '' };
        const responseVariable = typeof config.responseVariable === 'string' && config.responseVariable ? config.responseVariable : 'resposta.gpt';
        const failReasonVariable = typeof config.failReasonVariable === 'string' && config.failReasonVariable ? config.failReasonVariable : 'ai.fail.reason';
        const finish = async (port: 'success' | 'failure', nextContext: EngineContext, output: Record<string, unknown>) => {
          const edge = selectPortEdge(input.definition.edges, node.id, port);
          if (!edge) {
            if (port === 'failure') throw new NodeExecutionError('AI_FAILED', String(output.reason));
            throw new NodeExecutionError('DEAD_END', `O nó ${node.id} não possui uma saída válida.`);
          }
          await this.completeStep(executionId, step.id, edge.target, nextContext, asJson(output));
          return { next: edge.target };
        };
        const fail = (reason: string) => finish('failure', setContextPath(aiContext, failReasonVariable, reason), { reason });
        const key = await this.openAiKey(workspaceId);
        if (!key.ok) return fail(key.reason);
        const apiKey = key.key;
        if (config.autoSendResponse === true) {
          const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId }, include: { channel: true } });
          if (!conversation || conversation.channel.provider !== 'baileys' || conversation.channel.status !== 'CONNECTED') return fail('O canal precisa estar conectado para enviar a resposta da IA.');
        }
        const readsMedia = Boolean(latest) && ((config.understandImage === true && latest!.type === 'IMAGE') || (config.understandPdf === true && latest!.type === 'DOCUMENT'));
        const stored = readsMedia ? await this.prisma.messageMedia.findUnique({ where: { messageId: latest!.id } }) : null;
        if (readsMedia && !stored?.data) return fail('Arquivo grande demais ou indisponível para a IA.');
        const media = readsMedia && stored?.data ? { contentType: stored.contentType, data: Buffer.from(stored.data), fileName: stored.fileName } : null;
        const previousTurns = Math.min(20, Math.max(1, Number(config.contextInteractions) || 1)) - 1;
        const previous = previousTurns > 0 && latest ? await this.prisma.message.findMany({ where: { workspaceId, conversationId, createdAt: { lt: latest.createdAt }, body: { not: null } }, orderBy: { createdAt: 'desc' }, take: previousTurns, select: { direction: true, body: true } }) : [];
        const history = previous.reverse().map(item => ({ role: item.direction === 'INBOUND' ? 'user' as const : 'assistant' as const, content: item.body ?? '' }));
        const userMessage = renderTemplate(typeof config.userMessage === 'string' ? config.userMessage : '{{last_message}}', aiContext);
        const result = await callOpenAi({ apiKey, model: typeof config.model === 'string' && config.model ? config.model : 'gpt-5.4-mini', baseUrl: process.env.OPENAI_BASE_URL, messages: buildAiMessages({ systemPrompt: stringConfig(node, 'systemPrompt'), userMessage, history, media }) });
        if (!result.ok) return fail(result.reason);
        aiContext = setContextPath(aiContext, responseVariable, result.text);
        const successEdge = selectPortEdge(input.definition.edges, node.id, 'success');
        if (!successEdge) throw new NodeExecutionError('DEAD_END', `O nó ${node.id} não possui uma saída válida.`);
        await this.prisma.$transaction(async tx => {
          await tx.usageRecord.create({ data: { workspaceId, kind: 'ai_tokens', quantity: result.tokens, unit: 'token', costCents: 0, provider: 'openai', referenceId: executionId } });
          if (config.autoSendResponse === true) {
            const message = await tx.message.create({ data: { workspaceId, conversationId, direction: 'OUTBOUND', type: 'TEXT', status: 'PENDING', body: result.text.slice(0, 4096), authorType: 'automation', authorId: executionId } });
            await tx.outboxEvent.create({ data: { workspaceId, aggregate: 'Message', aggregateId: message.id, type: 'message.send.requested', payload: { messageId: message.id } } });
          }
          await this.finishInTransaction(tx, executionId, step.id, successEdge.target, aiContext, asJson({ tokens: result.tokens, chars: result.text.length }));
        });
        return { next: successEdge.target };
      }

      case 'webhook': {
        const url = stringConfig(node, 'url');
        if (!url.startsWith('https://')) throw new NodeExecutionError('WEBHOOK_HTTPS_REQUIRED', 'O webhook deve usar HTTPS.');
        const timeoutSeconds = Math.min(input.definition.settings.timeoutSeconds, 30);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
        let status: number | null = null;
        let body: string | null = null;
        let responseHeaders: Record<string, string> = {};
        let error: string | undefined;
        try {
          const method = typeof node.config.method === 'string' ? node.config.method.toUpperCase() : 'POST';
          const configuredHeaders = node.config.headers && typeof node.config.headers === 'object' && !Array.isArray(node.config.headers) ? node.config.headers as Record<string, unknown> : {};
          const headers = Object.fromEntries(Object.entries(configuredHeaders).filter((entry): entry is [string, string] => typeof entry[1] === 'string').map(([key, value]) => [key, renderTemplate(value, context)]));
          const configuredBody = typeof node.config.body === 'string' && node.config.body.trim() ? renderTemplate(node.config.body, context) : JSON.stringify({ executionId, conversationId, context });
          const response = await fetch(url, { method, headers: { 'content-type': 'application/json', 'idempotency-key': step.id, ...headers }, ...(!['GET', 'HEAD'].includes(method) ? { body: configuredBody } : {}), signal: controller.signal });
          status = response.status;
          body = (await response.text()).slice(0, 10_000);
          responseHeaders = Object.fromEntries(response.headers.entries());
        } catch (caught) {
          error = caught instanceof Error && caught.name === 'AbortError' ? `A integração não respondeu em ${timeoutSeconds} segundos.` : 'Não foi possível conectar à integração.';
        } finally {
          clearTimeout(timeout);
        }
        const outcome = integrationOutcome({ context, status, body, headers: responseHeaders, error, responseVariable: typeof node.config.responseVariable === 'string' && node.config.responseVariable ? node.config.responseVariable : undefined, responseFields: parseResponseFields(node.config.responseFields) });
        const edge = selectPortEdge(input.definition.edges, node.id, outcome.port);
        if (!edge) {
          if (outcome.port === 'failure') throw new NodeExecutionError('WEBHOOK_FAILED', String(outcome.output.error));
          throw new NodeExecutionError('DEAD_END', `O nó ${node.id} não possui uma saída válida.`);
        }
        await this.completeStep(executionId, step.id, edge.target, outcome.context as EngineContext, asJson(outcome.output));
        return { next: edge.target };
      }

      case 'agent': {
        const agentId = typeof node.config.agentId === 'string' ? node.config.agentId : '';
        const inbound = await this.prisma.message.findFirst({where:{workspaceId,conversationId,direction:'INBOUND'},orderBy:{createdAt:'desc'},select:{body:true}});
        const decision = agentId ? await this.agents.decide({workspaceId,agentId,message:inbound?.body??'',nodePrompt:typeof node.config.prompt==='string'?node.config.prompt:undefined,referenceId:executionId}) : {kind:'handoff' as const,confidence:1,reason:'AGENT_NOT_CONFIGURED: selecione um agente no bloco.',knowledgeChunks:0,unavailable:true};
        if(decision.kind==='handoff'){
          await this.prisma.$transaction([
            this.prisma.conversation.update({where:{id:conversationId},data:{mode:'HUMAN',status:'QUEUED'}}),
            this.prisma.executionStep.update({where:{id:step.id},data:{status:'SUCCEEDED',output:{handoff:true,reason:decision.reason,confidence:decision.confidence,agentId:decision.agentId??null,unavailable:decision.unavailable??false},finishedAt:new Date()}}),
            this.prisma.execution.update({where:{id:executionId},data:{status:'SUCCEEDED',currentNode:node.id,finishedAt:new Date()}})
          ]);return 'terminal';
        }
        const conversation=await this.prisma.conversation.findUnique({where:{id:conversationId},include:{channel:true}});
        if(!conversation||conversation.channel.provider!=='baileys'||conversation.channel.status!=='CONNECTED')throw new NodeExecutionError('CHANNEL_UNAVAILABLE','O canal precisa estar conectado para enviar a resposta do agente.');
        await this.prisma.$transaction(async tx=>{const message=await tx.message.create({data:{workspaceId,conversationId,direction:'OUTBOUND',type:'TEXT',status:'PENDING',body:decision.text!,authorType:'ai_agent',authorId:decision.agentId}});await tx.outboxEvent.create({data:{workspaceId,aggregate:'Message',aggregateId:message.id,type:'message.send.requested',payload:{messageId:message.id}}});await this.finishInTransaction(tx,executionId,step.id,nextNodeId,{...context,agent:{confidence:decision.confidence,agentId:decision.agentId}},{messageId:message.id,confidence:decision.confidence,agentId:decision.agentId,knowledgeChunks:decision.knowledgeChunks})});return 'continue';
      }
    }
  }

  private async openAiKey(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { openaiApiKeyEncrypted: true } });
    return resolveOpenAiKey(workspace?.openaiApiKeyEncrypted ?? null, process.env.OPENAI_API_KEY, value => this.cipher.decrypt(value));
  }

  private async completeStep(executionId: string, stepId: string, nextNodeId: string | undefined, context: EngineContext, output: Prisma.InputJsonValue) {
    await this.prisma.$transaction(async tx => this.finishInTransaction(tx, executionId, stepId, nextNodeId, context, output));
  }

  private async finishInTransaction(tx: Prisma.TransactionClient, executionId: string, stepId: string, nextNodeId: string | undefined, context: EngineContext, output: Prisma.InputJsonValue) {
    await tx.executionStep.update({ where: { id: stepId }, data: { status: 'SUCCEEDED', output, finishedAt: new Date() } });
    await tx.execution.update({ where: { id: executionId }, data: { currentNode: nextNodeId, context: asJson(context) } });
  }

  // Applies the contact's answer (or the expiry) to a waiting menu. Returns null when the execution
  // must stay as it is: an unrelated message keeps the menu waiting.
  private async resumeMenu(executionId: string, conversationId: string, job: AutomationJob, pending: PendingMenu, context: EngineContext, definition: AutomationDefinition): Promise<{ context: EngineContext; nextNodeId: string } | null> {
    const node = definition.nodes.find(item => item.id === pending.nodeId);
    if (!node || node.kind !== 'buttons') {
      await this.failExecution(executionId, 'NODE_NOT_FOUND', `Menu ${pending.nodeId} não encontrado.`);
      return null;
    }
    let next: EngineContext = { ...context, _runtime: {} };
    let output: Record<string, unknown>;
    if (job.action === 'menu_timeout') {
      next = setContextPath(next, 'menu', { timedOut: true });
      output = { timedOut: true };
    } else {
      const message = job.messageId ? await this.prisma.message.findUnique({ where: { id: job.messageId } }) : null;
      if (!message || message.conversationId !== conversationId || message.direction !== 'INBOUND') return null;
      const payload = message.providerPayload && typeof message.providerPayload === 'object' && !Array.isArray(message.providerPayload) ? message.providerPayload as { menuReply?: { id?: string; text?: string | null } } : {};
      const option = resolveMenuChoice(menuOptions(node), { id: payload.menuReply?.id, text: payload.menuReply?.text ?? message.body });
      if (!option) return null;
      next = setContextPath(next, 'menu', { choice: option.id, label: option.label, timedOut: false });
      const saveAs = typeof node.config.saveAs === 'string' ? node.config.saveAs.trim() : '';
      if (saveAs) next = setContextPath(next, saveAs, option.label);
      output = { choice: option.id, label: option.label, messageId: message.id };
    }
    const edge = selectNextEdge(node, definition.edges, next);
    await this.prisma.executionStep.update({ where: { id: pending.stepId }, data: { status: 'SUCCEEDED', output: asJson({ ...output, selectedEdgeId: edge?.id ?? null }), finishedAt: new Date() } });
    if (edge) return { context: next, nextNodeId: edge.target };
    if (job.action === 'menu_timeout') {
      // No inactivity exit wired: the journey simply ends when the menu expires.
      await this.prisma.execution.update({ where: { id: executionId }, data: { status: 'SUCCEEDED', currentNode: null, finishedAt: new Date(), context: asJson(next) } });
    } else {
      await this.failExecution(executionId, 'DEAD_END', `A opção escolhida no menu ${node.id} não possui saída.`);
    }
    return null;
  }

  private async failExecution(executionId: string, code: string, message: string) {
    const execution = await this.prisma.execution.findUnique({ where: { id: executionId }, select: { context: true } });
    if (!execution) return;
    const context = objectContext(execution.context);
    await this.prisma.execution.updateMany({ where: { id: executionId, status: { in: ['RUNNING', 'WAITING'] } }, data: { status: 'FAILED', finishedAt: new Date(), context: asJson({ ...context, _runtime: { ...context._runtime, error: { code, message } } }) } });
  }

  private async loadLiveContext(workspaceId: string, conversationId: string) {
    const [conversation, lastInbound] = await Promise.all([
      this.prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { workspace: { select: { timezone: true } }, contact: { include: { tags: { include: { tag: true } } } } }
      }),
      this.prisma.message.findFirst({ where: { workspaceId, conversationId, direction: 'INBOUND' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
    ]);
    if (!conversation) throw new NodeExecutionError('CONVERSATION_NOT_FOUND', 'A conversa da execução não existe.');
    const { contact } = conversation;
    return liveConditionContext({
      timeZone: conversation.workspace.timezone,
      now: new Date(),
      contact: { id: contact.id, name: contact.name, phone: contact.phone, email: contact.email, stage: contact.stage, customFields: contact.customFields, tags: contact.tags.map(item => ({ id: item.tag.id, name: item.tag.name })) },
      conversation: { id: conversation.id, status: conversation.status, mode: conversation.mode, assigneeId: conversation.assigneeId, queue: conversation.queue },
      lastInboundAt: lastInbound?.createdAt ?? null
    });
  }

  private loadExecution(executionId: string) {
    return this.prisma.execution.findUnique({ where: { id: executionId }, include: { playbookVersion: true } });
  }

  async onModuleDestroy() { await this.queue.close(); }
}
