import { randomUUID } from 'node:crypto';
import { Inject,Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, type ExecutionStep } from '@prisma/client';
import { Queue } from 'bullmq';
import {AutomationDefinitionSchema,AutomationDistributorConfigSchema,AutomationNotificationConfigSchema,AutomationPixelConfigSchema,AutomationWaitResponseConfigSchema,DISTRIBUTOR_ROUTE_FIELD,renderUrlTemplate} from '@nexo/contracts';
import {assertPublicHttpsUrl,kanbanAction} from '@nexo/domain';
import { PrismaService } from '../infra/prisma.service.js';
import { RedisService } from '../infra/redis.service.js';
import { menuOptions, menuTimeoutSeconds, renderTemplate, resolveMenuChoice, routesByChoice, selectAiRouteEdge, selectNextEdge, selectPortEdge, setContextPath, type AutomationDefinition, type AutomationNode } from './routing.js';
import { integrationOutcome, parseResponseFields } from './integration.js';
import { liveConditionContext, mergeLiveContext } from './live-context.js';
import { buildAiMessages, callOpenAi, resolveOpenAiKey, transcribeOpenAiAudio } from './ai-call.js';
import { aiLastMessage, joinReplies, pendingWaitOf,waitReplyActions, waitTimeoutSeconds, type PendingWait } from './wait-response.js';
import { itemMessage, pauseSeconds, sequenceItems, sequenceJobOptions, type SequenceItem } from './message-sequence.js';
import { NO_CTWA_MESSAGE, PIXEL_TIMEOUT_SECONDS, buildPixelEvent, parsePixelValue, pixelOutcome, pixelRequest } from '@nexo/domain';
import { FieldCipher } from '../crypto/field-cipher.js';
import { loadConfig } from '../config.js';
import { AgentRuntimeService } from '../agent/agent-runtime.service.js';
import {FlowJumpError,prepareFlowJump} from './flow-jump.js';
import {decideDistributorAssignment,retryTx} from './distributor.js';
import {decideNotificationLimit,normalizeE164,notificationWindowStart} from './notification.js';

const AUTOMATION_QUEUE = 'automation.execute';
const RELEASE_LOCK = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
const outcomeTypes = new Set(['QUALIFIED', 'APPOINTMENT', 'SALE', 'RESOLVED', 'HANDOFF', 'DISQUALIFIED']);

// `menu_reply` / `menu_timeout` resume any pending wait (menu or wait_response); the names stay so already-queued jobs remain valid.
export type AutomationJob = { executionId: string; action?: 'start' | 'resume' | 'menu_reply' | 'menu_timeout' | 'sequence_next'; resumeStepId?: string; messageId?: string; sequenceIndex?: number; failedIndex?: number };
type PendingSequence = { stepId: string; index: number };
type QuoteNext = {messageId:string;remaining:number};
type RuntimeState = { pendingDelayStepId?: string; pendingWait?: PendingWait; pendingSequence?: PendingSequence; quoteNext?:QuoteNext;jumpDepth?:number; error?: { code: string; message: string } };
type EngineContext = Record<string, unknown> & { _runtime?: RuntimeState };

class NodeExecutionError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

const asJson = (value: unknown) => value as Prisma.InputJsonValue;
const objectContext = (value: Prisma.JsonValue): EngineContext => value && typeof value === 'object' && !Array.isArray(value) ? value as EngineContext : {};
const stableRuntime=(context:EngineContext):RuntimeState=>{
  const runtime=context._runtime??{};
  return {
    ...(typeof runtime.jumpDepth==='number'?{jumpDepth:runtime.jumpDepth}:{}),
    ...(runtime.quoteNext&&typeof runtime.quoteNext.messageId==='string'&&Number.isInteger(runtime.quoteNext.remaining)&&runtime.quoteNext.remaining>0?{quoteNext:runtime.quoteNext}:{})
  };
};
const stableContext=(context:EngineContext):EngineContext=>({...context,_runtime:stableRuntime(context)});
const consumeQuote=(context:EngineContext):{context:EngineContext;quotedMessageId?:string}=>{
  const base=stableContext(context);const quote=base._runtime?.quoteNext;
  if(!quote)return {context:base};
  const runtime={...base._runtime};
  if(quote.remaining>1)runtime.quoteNext={...quote,remaining:quote.remaining-1};else delete runtime.quoteNext;
  return {context:{...base,_runtime:runtime},quotedMessageId:quote.messageId};
};
const stringConfig = (node: AutomationNode, key: string) => {
  const value = node.config[key];
  if (typeof value !== 'string' || !value.trim()) throw new NodeExecutionError('INVALID_NODE_CONFIG', `O nó ${node.id} requer config.${key}.`);
  return value.trim();
};
@Injectable()
export class AutomationEngineService implements OnModuleDestroy {
  private readonly queue: Queue<AutomationJob>;
  private readonly cipher = new FieldCipher(loadConfig().encryptionKey);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,@Inject(RedisService) private readonly redis: RedisService,@Inject(AgentRuntimeService) private readonly agents: AgentRuntimeService) {
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
      const menuDue = (job.action === 'menu_reply' || job.action === 'menu_timeout') && Boolean(job.resumeStepId) && pendingWaitOf(pending)?.stepId === job.resumeStepId;
      const sequenceDue = job.action === 'sequence_next' && pending?.pendingSequence?.stepId === job.resumeStepId && job.sequenceIndex === pending!.pendingSequence!.index + 1;
      if (!delayDue && !menuDue && !sequenceDue) return;
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
      const pendingWait = pendingWaitOf(context._runtime);
      const pendingSequence = context._runtime?.pendingSequence;
      if (pendingSequence) {
        const resumed = await this.resumeSequence(execution, job, pendingSequence, context, definition);
        if (!resumed) return;
        context = resumed.context;
        currentNodeId = resumed.nextNodeId;
      } else if (pendingWait) {
        const resumed = await this.resumeWait(execution.id, execution.conversationId, job, pendingWait, context, definition);
        if (!resumed) return;
        context = resumed.context;
        currentNodeId = resumed.nextNodeId;
      } else {
        context = stableContext(context);
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
        const result = await this.runNode({ executionId: execution.id, workspaceId: execution.workspaceId, playbookId:execution.playbookVersion.playbookId, conversationId: execution.conversationId, context, definition, node, step, nextNodeId });
        if (result === 'waiting' || result === 'terminal') return;
        if (typeof result === 'object') routedNodeId = result.next;
      } catch (error) {
        await this.failStep(execution.id, step.id, node.id, error);
        throw error;
      }
      processed += 1;
      currentNodeId = routedNodeId;
      if (!currentNodeId) {
        await this.succeedExecution(execution.id);
        return;
      }
    }
  }

  private async runNode(input: {
    executionId: string;
    workspaceId: string;
    playbookId:string;
    conversationId: string;
    context: EngineContext;
    definition: AutomationDefinition;
    node: AutomationNode;
    step: ExecutionStep;
    nextNodeId?: string;
  }): Promise<'continue' | 'waiting' | 'terminal' | { next: string }> {
    const { executionId, workspaceId, playbookId,conversationId, context, node, step, nextNodeId } = input;
    const waitsForChoice = routesByChoice(node, input.definition.edges);

    switch (node.kind) {
      case 'condition':
        // A branch left unconnected ends the flow, as in Leona.
        if (!nextNodeId) {
          await this.prisma.$transaction(async tx => {
            await tx.executionStep.update({ where: { id: step.id }, data: { status: 'SUCCEEDED', output: { selectedTarget: null, endedFlow: true }, finishedAt: new Date() } });
            await tx.execution.update({ where: { id: executionId }, data: { status: 'SUCCEEDED', currentNode: node.id, context: asJson(context), finishedAt: new Date() } });
          });
          return 'terminal';
        }
        await this.completeStep(executionId, step.id, nextNodeId, context, { selectedTarget: nextNodeId });
        return 'continue';
      case 'trigger':
        await this.completeStep(executionId, step.id, nextNodeId, context, { selectedTarget: nextNodeId });
        return 'continue';

      case 'message': {
        const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId }, include: { channel: true } });
        if (!conversation || conversation.workspaceId !== workspaceId) throw new NodeExecutionError('CONVERSATION_NOT_FOUND', 'A conversa da execução não existe.');
        if (conversation.channel.provider !== 'baileys' || conversation.channel.status !== 'CONNECTED') throw new NodeExecutionError('CHANNEL_UNAVAILABLE', 'O canal Baileys precisa estar conectado para enviar a mensagem.');
        return this.runSequenceItem(executionId, workspaceId, conversationId, step, node, context, 0, this.messageItems(node), nextNodeId);
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
        const quote=consumeQuote(context);
        const providerPayload = node.kind === 'buttons'
          ? {
              kind: 'buttons', mode: node.config.mode === 'list' ? 'list' : 'buttons', buttons,
              ...(typeof node.config.footer === 'string' && node.config.footer.trim() ? { footer: renderTemplate(node.config.footer, context) } : {}),
              ...(typeof node.config.buttonText === 'string' && node.config.buttonText.trim() ? { buttonText: renderTemplate(node.config.buttonText, context) } : {})
            }
          : node.kind === 'sticker' ? { kind: 'sticker' }
          : node.kind === 'audio' ? { kind: 'audio', ptt: node.config.ptt === true }
          : { kind: 'image' };
        const outboundPayload={...providerPayload,...(quote.quotedMessageId?{quotedMessageId:quote.quotedMessageId}:{})};
        await this.prisma.$transaction(async tx => {
          const message = await tx.message.create({ data: { workspaceId, conversationId, direction: 'OUTBOUND', type: messageType, status: 'PENDING', body, mediaUrl: rawUrl || null, providerPayload: asJson(outboundPayload), authorType: 'automation', authorId: executionId } });
          await tx.outboxEvent.create({ data: { workspaceId, aggregate: 'Message', aggregateId: message.id, type: 'message.send.requested', payload: { messageId: message.id } } });
          if (!waitsForChoice) {
            await this.finishInTransaction(tx, executionId, step.id, nextNodeId, quote.context, { messageId: message.id, kind: node.kind });
            return;
          }
          // The step stays RUNNING until the contact answers or the menu expires.
          const pendingWait: PendingWait = { stepId: step.id, nodeId: node.id, kind: 'menu' };
          await tx.executionStep.update({ where: { id: step.id }, data: { output: asJson({ messageId: message.id, kind: node.kind, waitingForReply: true }) } });
          await tx.execution.update({ where: { id: executionId }, data: { status: 'WAITING', currentNode: node.id, context: asJson({ ...quote.context, _runtime: { ...stableRuntime(quote.context), pendingWait } }) } });
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
        if (!nextNodeId) {
          await this.completeStep(executionId, step.id, undefined, context, { delaySeconds: seconds, endedFlow: true });
          await this.succeedExecution(executionId);
          return 'terminal';
        }
        const waitingContext: EngineContext = { ...context, _runtime: { ...stableRuntime(context),pendingDelayStepId: step.id } };
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

      case 'pixel': {
        const config = AutomationPixelConfigSchema.safeParse(node.config);
        if (!config.success) throw new NodeExecutionError('INVALID_NODE_CONFIG', `O nó ${node.id} possui uma configuração de Pixel inválida.`);
        const { pixelId, eventName, currency } = config.data;
        const finish = async (status: number | null, outcome: ReturnType<typeof pixelOutcome>) => {
          const edge = selectPortEdge(input.definition.edges, node.id, outcome.port);
          if (!edge) {
            if (outcome.port === 'failure') throw new NodeExecutionError('PIXEL_FAILED', outcome.error!.message);
            await this.completeStep(executionId, step.id, undefined, context, asJson({ eventName, eventId: step.id, status, endedFlow: true }));
            await this.succeedExecution(executionId);
            return 'terminal' as const;
          }
          const nextContext = outcome.error ? setContextPath(context, 'pixel.error', outcome.error) : context;
          await this.completeStep(executionId, step.id, edge.target, nextContext, asJson({ eventName, eventId: step.id, status, ...(outcome.error ? { error: outcome.error.message } : {}) }));
          return { next: edge.target };
        };
        const fail = (message: string) => finish(null, { port: 'failure', error: { status: null, message } });
        const pixel = await this.prisma.metaPixel.findFirst({ where: { id: pixelId, workspaceId }, select: { pixelId: true, accessTokenEncrypted: true, pageId: true } });
        if (!pixel) return fail('O pixel configurado no bloco não existe mais.');
        let accessToken: string;
        try { accessToken = this.cipher.decrypt(pixel.accessTokenEncrypted); } catch { return fail('Não foi possível ler o token do pixel. Cadastre o token novamente.'); }
        const rawValue = config.data.value ? renderTemplate(config.data.value, context) : '';
        const value = rawValue.trim() ? parsePixelValue(rawValue) : undefined;
        if (value === null || (eventName === 'Purchase' && value === undefined)) return fail(`Valor do evento inválido: "${rawValue.slice(0, 50)}".`);
        const conversation = await this.prisma.conversation.findFirst({ where: { id: conversationId, workspaceId }, select: { metadata: true } });
        const ctwa = objectContext(conversation?.metadata ?? null).ctwa as { clid?: unknown } | undefined;
        if (typeof ctwa?.clid !== 'string' || !ctwa.clid) return fail(NO_CTWA_MESSAGE);
        const pageId = (config.data.pageId ? renderTemplate(config.data.pageId, context).trim() : '') || pixel.pageId || undefined;
        const request = pixelRequest(pixel.pixelId, accessToken, buildPixelEvent({ eventName, eventTime: Math.floor(Date.now() / 1000), eventId: step.id, ctwaClid: ctwa.clid, pageId, value, currency }));
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PIXEL_TIMEOUT_SECONDS * 1000);
        let status: number | null = null;
        let body: unknown = null;
        let error: string | undefined;
        try {
          const response = await fetch(request.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: request.body, redirect: 'manual', signal: controller.signal });
          status = response.status;
          const text = (await response.text()).slice(0, 10_000);
          try { body = JSON.parse(text); } catch { body = text; }
        } catch (caught) {
          error = caught instanceof Error && caught.name === 'AbortError' ? `A Meta não respondeu em ${PIXEL_TIMEOUT_SECONDS} segundos.` : 'Não foi possível conectar à Meta.';
        } finally {
          clearTimeout(timeout);
        }
        return finish(status, pixelOutcome(status, body, error));
      }

      case 'kanban': {
        const boardId=typeof node.config.boardId==='string'?node.config.boardId:'';
        const columnId=typeof node.config.columnId==='string'?node.config.columnId:'';
        const mode=node.config.mode==='create_only'||node.config.mode==='move_only'?node.config.mode:'create_or_move';
        if(!boardId||!columnId)throw new NodeExecutionError('INVALID_KANBAN_CONFIG','Selecione o quadro e a coluna do Kanban.');
        const conversation=await this.prisma.conversation.findFirst({where:{id:conversationId,workspaceId},select:{contactId:true}});
        if(!conversation)throw new NodeExecutionError('CONVERSATION_NOT_FOUND','A conversa da execução não existe.');
        await this.prisma.$transaction(async tx=>{
          const column=await tx.kanbanColumn.findFirst({where:{id:columnId,boardId,board:{workspaceId}},select:{id:true}});
          if(!column)throw new NodeExecutionError('KANBAN_TARGET_NOT_FOUND','O quadro ou a coluna do Kanban foi excluído.');
          const existing=await tx.kanbanCard.findUnique({where:{boardId_contactId:{boardId,contactId:conversation.contactId}}});
          const action=kanbanAction(mode,existing?.columnId??null,columnId);
          let card=existing;
          if(action==='create'){
            const position=await tx.kanbanCard.count({where:{columnId}});
            card=await tx.kanbanCard.create({data:{boardId,columnId,contactId:conversation.contactId,conversationId,position,movedByType:'execution',movedById:executionId}});
            await tx.kanbanCardEvent.create({data:{cardId:card.id,toColumnId:columnId,movedByType:'execution',movedById:executionId}});
          }else if(action==='move'){
            const fromColumnId=existing!.columnId;const position=await tx.kanbanCard.count({where:{columnId}});
            card=await tx.kanbanCard.update({where:{id:existing!.id},data:{columnId,conversationId,position,movedAt:new Date(),movedByType:'execution',movedById:executionId}});
            await tx.kanbanCardEvent.create({data:{cardId:card.id,fromColumnId,toColumnId:columnId,movedByType:'execution',movedById:executionId}});
            await tx.kanbanCard.updateMany({where:{columnId:fromColumnId,position:{gt:existing!.position}},data:{position:{decrement:1}}});
          }
          await this.finishInTransaction(tx,executionId,step.id,nextNodeId,context,{action,cardId:card?.id??null,boardId,columnId});
        },{isolationLevel:'Serializable'});
        return 'continue';
      }

      case 'distributor': {
        const parsed=AutomationDistributorConfigSchema.safeParse(node.config);if(!parsed.success)throw new NodeExecutionError('INVALID_DISTRIBUTOR_CONFIG','Configure ao menos duas saídas válidas no distribuidor.');
        const conversation=await this.prisma.conversation.findFirst({where:{id:conversationId,workspaceId},select:{contactId:true}});if(!conversation)throw new NodeExecutionError('CONVERSATION_NOT_FOUND','A conversa da execução não existe.');
        // Each attempt re-reads counts and the assignment, so a lost race on the unique insert reuses the winner's output.
        const selected=await retryTx(()=>this.prisma.$transaction(async tx=>{
          for(const output of parsed.data.outputs)await tx.flowDistributorCount.upsert({where:{playbookId_nodeId_outputId:{playbookId,nodeId:node.id,outputId:output.id}},create:{playbookId,nodeId:node.id,outputId:output.id,count:0},update:{}});
          const counts=await tx.$queryRaw<Array<{outputId:string;count:number}>>(Prisma.sql`SELECT "outputId", "count" FROM "FlowDistributorCount" WHERE "playbookId" = ${playbookId} AND "nodeId" = ${node.id} FOR UPDATE`);
          const assignment=parsed.data.preventRepeat?await tx.flowDistributorAssignment.findUnique({where:{playbookId_nodeId_contactId:{playbookId,nodeId:node.id,contactId:conversation.contactId}}}):null;
          const decision=decideDistributorAssignment({outputs:parsed.data.outputs,counts,preventRepeat:parsed.data.preventRepeat,existingOutputId:assignment?.outputId});
          if(decision.assignmentWrite==='create')await tx.flowDistributorAssignment.create({data:{playbookId,nodeId:node.id,contactId:conversation.contactId,outputId:decision.outputId}});
          if(decision.assignmentWrite==='update')await tx.flowDistributorAssignment.update({where:{playbookId_nodeId_contactId:{playbookId,nodeId:node.id,contactId:conversation.contactId}},data:{outputId:decision.outputId}});
          if(decision.incrementCounter)await tx.flowDistributorCount.update({where:{playbookId_nodeId_outputId:{playbookId,nodeId:node.id,outputId:decision.outputId}},data:{count:{increment:1}}});
          const edge=input.definition.edges.find(item=>item.source===node.id&&item.condition?.field===DISTRIBUTOR_ROUTE_FIELD&&item.condition.operator==='equals'&&item.condition.value===decision.outputId);
          if(!edge)throw new NodeExecutionError('DISTRIBUTOR_ROUTE_NOT_FOUND',`A saída ${decision.outputId} não está conectada.`);
          const nextContext=setContextPath(context,DISTRIBUTOR_ROUTE_FIELD,decision.outputId);await this.finishInTransaction(tx,executionId,step.id,edge.target,nextContext,{outputId:decision.outputId,reused:decision.source==='existing'});return {edge,nextContext};
        },{isolationLevel:'Serializable'}));
        return {next:selected.edge.target};
      }

      case 'notification': {
        const parsed=AutomationNotificationConfigSchema.safeParse(node.config);if(!parsed.success)throw new NodeExecutionError('INVALID_NOTIFICATION_CONFIG','Configure número e mensagem da notificação.');
        const phone=normalizeE164(parsed.data.phone);if(!phone)throw new NodeExecutionError('INVALID_NOTIFICATION_PHONE','Use um telefone E.164 com DDI.');
        const text=renderTemplate(parsed.data.message,context);const conversation=await this.prisma.conversation.findFirst({where:{id:conversationId,workspaceId},select:{channelId:true}});if(!conversation)throw new NodeExecutionError('CONVERSATION_NOT_FOUND','A conversa da execução não existe.');
        await this.prisma.$transaction(async tx=>{
          await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${'notification:'+workspaceId}))`);
          const used=await tx.outboxEvent.count({where:{workspaceId,type:'notification.send.requested',createdAt:{gte:notificationWindowStart(new Date())}}});const limit=decideNotificationLimit(used);
          if(limit.allowed)await tx.outboxEvent.create({data:{workspaceId,aggregate:'Execution',aggregateId:executionId,type:'notification.send.requested',payload:{channelId:conversation.channelId,phone,text}}});
          else await tx.outboxEvent.create({data:{workspaceId,aggregate:'Execution',aggregateId:executionId,type:'notification.send.discarded',payload:{phone,reason:'HOURLY_LIMIT'},processedAt:new Date()}});
          await this.finishInTransaction(tx,executionId,step.id,nextNodeId,context,{phone,queued:limit.allowed,discarded:!limit.allowed,remaining:limit.remaining});
        });return 'continue';
      }

      case 'flow_jump': {
        try{
          await this.prisma.$transaction(async tx=>{
            const targetId=typeof node.config.targetPlaybookId==='string'?node.config.targetPlaybookId:'';
            const target=targetId?await tx.playbook.findFirst({where:{id:targetId,workspaceId},select:{id:true,workspaceId:true,status:true,activeVersionId:true,name:true}}):null;
            const plan=prepareFlowJump({workspaceId,conversationId,sourceNodeId:node.id,sourceContext:context,targetPlaybookId:targetId,target});
            const jumped=await tx.execution.create({data:{...plan.targetExecution,context:asJson(plan.targetExecution.context)}});
            await tx.executionStep.update({where:{id:step.id},data:{...plan.sourceStep,finishedAt:new Date()}});
            await tx.execution.update({where:{id:executionId},data:{...plan.sourceExecution,context:asJson(context),finishedAt:new Date()}});
            await tx.outboxEvent.create({data:{workspaceId,aggregate:'Execution',aggregateId:jumped.id,type:'automation.execution.requested',payload:{executionId:jumped.id}}});
          },{isolationLevel:'Serializable'});
          return 'terminal';
        }catch(error){if(error instanceof FlowJumpError)throw new NodeExecutionError(error.code,error.message);throw error}
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

      case 'wait_response': {
        // `since` bounds which inbound messages count as the reply; startedAt comes from the DB clock, like Message.createdAt.
        const pendingWait: PendingWait = { stepId: step.id, nodeId: node.id, kind: 'reply', since: step.startedAt.toISOString() };
        const question = typeof node.config.message === 'string' ? renderTemplate(node.config.message, context).trim() : '';
        if (question) {
          const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId }, include: { channel: true } });
          if (!conversation || conversation.workspaceId !== workspaceId) throw new NodeExecutionError('CONVERSATION_NOT_FOUND', 'A conversa da execução não existe.');
          if (conversation.channel.provider !== 'baileys' || conversation.channel.status !== 'CONNECTED') throw new NodeExecutionError('CHANNEL_UNAVAILABLE', 'O canal Baileys precisa estar conectado para enviar a mensagem.');
        }
        await this.prisma.$transaction(async tx => {
          if (question) {
            const message = await tx.message.create({ data: { workspaceId, conversationId, direction: 'OUTBOUND', type: 'TEXT', status: 'PENDING', body: question.slice(0, 4096), authorType: 'automation', authorId: executionId } });
            await tx.outboxEvent.create({ data: { workspaceId, aggregate: 'Message', aggregateId: message.id, type: 'message.send.requested', payload: { messageId: message.id } } });
          }
          await tx.executionStep.update({ where: { id: step.id }, data: { output: { waitingForReply: true, sentQuestion: Boolean(question) } } });
          await tx.execution.update({ where: { id: executionId }, data: { status: 'WAITING', currentNode: node.id, context: asJson({ ...context, _runtime: { ...stableRuntime(context),pendingWait } }) } });
        });
        try {
          await this.queue.add('menu_timeout', { executionId, action: 'menu_timeout', resumeStepId: step.id }, { jobId: `automation-wait-timeout-${executionId}-${step.id}`, delay: waitTimeoutSeconds(node.config).seconds * 1000, attempts: 5, backoff: { type: 'exponential', delay: 1_000 }, removeOnComplete: 1_000, removeOnFail: 5_000 });
        } catch (error) {
          await this.failExecution(executionId, 'WAIT_TIMEOUT_SCHEDULING_FAILED', error instanceof Error ? error.message : 'Não foi possível agendar a expiração da espera.');
          throw error;
        }
        return 'waiting';
      }

      case 'ai': {
        const config = node.config;
        const latest = await this.aiSourceMessage(executionId, step.id, workspaceId, conversationId, context, config);
        let aiContext: EngineContext = { ...context, last_message: aiLastMessage(context, latest) };
        const responseVariable = typeof config.responseVariable === 'string' && config.responseVariable ? config.responseVariable : 'resposta.gpt';
        const failReasonVariable = typeof config.failReasonVariable === 'string' && config.failReasonVariable ? config.failReasonVariable : 'ai.fail.reason';
        const finish = async (port: 'success' | 'failure', nextContext: EngineContext, output: Record<string, unknown>) => {
          const edge = selectPortEdge(input.definition.edges, node.id, port);
          if (!edge) {
            if (port === 'failure') throw new NodeExecutionError('AI_FAILED', String(output.reason));
            await this.completeStep(executionId, step.id, undefined, nextContext, asJson({ ...output, endedFlow: true }));
            await this.succeedExecution(executionId);
            return 'terminal' as const;
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
        const readsMedia = Boolean(latest) && (
          (config.understandAudio === true && latest!.type === 'AUDIO') ||
          ((config.understandImage === true || config.identifyReceipt === true) && latest!.type === 'IMAGE') ||
          ((config.understandPdf === true || config.identifyReceipt === true) && latest!.type === 'DOCUMENT')
        );
        const stored = readsMedia ? await this.prisma.messageMedia.findUnique({ where: { messageId: latest!.id } }) : null;
        if (readsMedia && !stored?.data) return fail('Arquivo grande demais ou indisponível para a IA.');
        let media = readsMedia && stored?.data ? { contentType: stored.contentType, data: Buffer.from(stored.data), fileName: stored.fileName } : null;
        if (media && latest?.type === 'AUDIO') {
          const transcription = await transcribeOpenAiAudio({ apiKey, media, baseUrl: process.env.OPENAI_BASE_URL });
          if (!transcription.ok) return fail(transcription.reason);
          aiContext = setContextPath(aiContext, 'last_message', transcription.text);
          aiContext = setContextPath(aiContext, 'ai.transcription', transcription.text);
          media = null;
        }
        const previousTurns = Math.min(20, Math.max(1, Number(config.contextInteractions) || 1)) - 1;
        const previous = previousTurns > 0 && latest ? await this.prisma.message.findMany({ where: { workspaceId, conversationId, createdAt: { lt: latest.createdAt }, body: { not: null } }, orderBy: { createdAt: 'desc' }, take: previousTurns, select: { direction: true, body: true } }) : [];
        const history = previous.reverse().map(item => ({ role: item.direction === 'INBOUND' ? 'user' as const : 'assistant' as const, content: item.body ?? '' }));
        const userMessage = renderTemplate(typeof config.userMessage === 'string' ? config.userMessage : '{{last_message}}', aiContext);
        const smartConditionals = Array.isArray(config.smartConditionals) ? config.smartConditionals.flatMap(item => {
          const value = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
          return typeof value.id === 'string' && typeof value.label === 'string' && typeof value.instruction === 'string' ? [{ id: value.id, label: value.label, instruction: value.instruction }] : [];
        }) : [];
        const result = await callOpenAi({
          apiKey,
          model: typeof config.model === 'string' && config.model ? config.model : 'gpt-5.4-mini',
          baseUrl: process.env.OPENAI_BASE_URL,
          messages: buildAiMessages({ systemPrompt: stringConfig(node, 'systemPrompt'), userMessage, history, media }),
          routing: { identifyReceipt: config.identifyReceipt === true, conditionals: smartConditionals }
        });
        if (!result.ok) return fail(result.reason);
        aiContext = setContextPath(aiContext, responseVariable, result.text);
        const routeId = result.receiptValid ? 'receipt_valid' : result.routeId;
        aiContext = setContextPath(aiContext, 'ai.route', routeId);
        aiContext = setContextPath(aiContext, 'ai.receiptValid', result.receiptValid);
        const successEdge = selectAiRouteEdge(input.definition.edges, node.id, routeId);
        if (!successEdge) throw new NodeExecutionError('DEAD_END', `O nó ${node.id} não possui uma saída válida.`);
        const quote=config.autoSendResponse===true?consumeQuote(aiContext):{context:aiContext};
        await this.prisma.$transaction(async tx => {
          await tx.usageRecord.create({ data: { workspaceId, kind: 'ai_tokens', quantity: result.tokens, unit: 'token', costCents: 0, provider: 'openai', referenceId: executionId } });
          if (config.autoSendResponse === true) {
            const message = await tx.message.create({ data: { workspaceId, conversationId, direction: 'OUTBOUND', type: 'TEXT', status: 'PENDING', body: result.text.slice(0, 4096),...(quote.quotedMessageId?{providerPayload:asJson({quotedMessageId:quote.quotedMessageId})}:{}),authorType: 'automation', authorId: executionId } });
            await tx.outboxEvent.create({ data: { workspaceId, aggregate: 'Message', aggregateId: message.id, type: 'message.send.requested', payload: { messageId: message.id } } });
          }
          await this.finishInTransaction(tx, executionId, step.id, successEdge.target, quote.context, asJson({ tokens: result.tokens, chars: result.text.length, routeId, receiptValid: result.receiptValid }));
        });
        return { next: successEdge.target };
      }

      case 'webhook': {
        const url = renderUrlTemplate(stringConfig(node, 'url'), context);
        const timeoutSeconds = Math.min(input.definition.settings.timeoutSeconds, 30);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
        let status: number | null = null;
        let body: string | null = null;
        let responseHeaders: Record<string, string> = {};
        let error: string | undefined;
        // A blocked or unresolvable URL is an Integração failure (routes to "erro"), not an execution abort.
        try { await assertPublicHttpsUrl(url); } catch (caught) { error = caught instanceof Error ? caught.message : 'A URL da integração não é permitida.'; }
        if (!error) try {
          const method = typeof node.config.method === 'string' ? node.config.method.toUpperCase() : 'POST';
          const configuredHeaders = node.config.headers && typeof node.config.headers === 'object' && !Array.isArray(node.config.headers) ? node.config.headers as Record<string, unknown> : {};
          const blockedHeaders=new Set(['connection','content-length','host','proxy-authorization','transfer-encoding','upgrade']);
          const headers = Object.fromEntries(Object.entries(configuredHeaders).filter((entry): entry is [string, string] => typeof entry[1] === 'string'&&!blockedHeaders.has(entry[0].toLowerCase())).map(([key, value]) => [key, renderTemplate(value, context)]));
          const configuredBody = typeof node.config.body === 'string' && node.config.body.trim() ? renderTemplate(node.config.body, context) : JSON.stringify({ executionId, conversationId, context });
          const response = await fetch(url, { method, headers: { 'content-type': 'application/json', 'idempotency-key': step.id, ...headers }, ...(!['GET', 'HEAD'].includes(method) ? { body: configuredBody } : {}), redirect:'manual', signal: controller.signal });
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
          await this.completeStep(executionId, step.id, undefined, outcome.context as EngineContext, asJson({ ...outcome.output, endedFlow: true }));
          await this.succeedExecution(executionId);
          return 'terminal';
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
        const nextAgentContext:EngineContext={...context,agent:{confidence:decision.confidence,agentId:decision.agentId}};const quote=consumeQuote(nextAgentContext);
        await this.prisma.$transaction(async tx=>{const message=await tx.message.create({data:{workspaceId,conversationId,direction:'OUTBOUND',type:'TEXT',status:'PENDING',body:decision.text!,...(quote.quotedMessageId?{providerPayload:asJson({quotedMessageId:quote.quotedMessageId})}:{}),authorType:'ai_agent',authorId:decision.agentId}});await tx.outboxEvent.create({data:{workspaceId,aggregate:'Message',aggregateId:message.id,type:'message.send.requested',payload:{messageId:message.id}}});await this.finishInTransaction(tx,executionId,step.id,nextNodeId,quote.context,{messageId:message.id,confidence:decision.confidence,agentId:decision.agentId,knowledgeChunks:decision.knowledgeChunks})});return 'continue';
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

  private messageItems(node: AutomationNode) {
    let items: SequenceItem[];
    try { items = sequenceItems(node.config); } catch { throw new NodeExecutionError('INVALID_NODE_CONFIG', `O nó ${node.id} possui um conteúdo inválido.`); }
    if (!items.length) throw new NodeExecutionError('INVALID_NODE_CONFIG', `O nó ${node.id} requer ao menos um conteúdo.`);
    return items;
  }

  // Sends (or waits on) one item; the next item is scheduled by the outbound worker after SENT, or by the pause delay.
  private async runSequenceItem(executionId: string, workspaceId: string, conversationId: string, step: ExecutionStep, node: AutomationNode, context: EngineContext, index: number, items: SequenceItem[], nextNodeId: string | undefined): Promise<'continue' | 'waiting'> {
    const base=stableContext(context);
    if (index >= items.length) {
      await this.completeStep(executionId, step.id, nextNodeId, base, { items: items.length });
      return 'continue';
    }
    const item = items[index]!;
    if (item.type === 'pause') {
      const waiting = { status: 'WAITING' as const, currentNode: node.id, context: asJson({ ...base, _runtime: { ...stableRuntime(base),pendingSequence: { stepId: step.id, index } } }) };
      await this.prisma.execution.update({ where: { id: executionId }, data: waiting });
      try {
        await this.queue.add('sequence_next', { executionId, action: 'sequence_next', resumeStepId: step.id, sequenceIndex: index + 1 }, sequenceJobOptions(step.id, index + 1, pauseSeconds(item) * 1000));
      } catch (error) {
        await this.failExecution(executionId, 'SEQUENCE_SCHEDULING_FAILED', error instanceof Error ? error.message : 'Não foi possível agendar a pausa.');
        throw error;
      }
      return 'waiting';
    }
    let content: ReturnType<typeof itemMessage>;
    try { content = itemMessage(item, context); } catch (error) {
      const code = error instanceof Error ? error.message : 'INVALID_NODE_CONFIG';
      throw new NodeExecutionError(code, code === 'EMPTY_MESSAGE' ? 'A mensagem ficou vazia após a interpolação.' : code === 'MEDIA_HTTPS_REQUIRED' ? 'A mídia precisa usar uma URL HTTPS.' : `O item ${index + 1} da mensagem é inválido.`);
    }
    const quote=consumeQuote(base);
    const providerPayload = { ...content.providerPayload, ...(quote.quotedMessageId?{quotedMessageId:quote.quotedMessageId}:{}),sequence: { executionId, stepId: step.id, index } };
    const waiting = { status: 'WAITING' as const, currentNode: node.id, context: asJson({ ...quote.context, _runtime: { ...stableRuntime(quote.context),pendingSequence: { stepId: step.id, index } } }) };
    await this.prisma.$transaction(async tx => {
      const message = await tx.message.create({ data: { workspaceId, conversationId, direction: 'OUTBOUND', type: content.type, status: 'PENDING', body: content.body, mediaUrl: content.mediaUrl, providerPayload: asJson(providerPayload), authorType: 'automation', authorId: executionId } });
      await tx.outboxEvent.create({ data: { workspaceId, aggregate: 'Message', aggregateId: message.id, type: 'message.send.requested', payload: { messageId: message.id } } });
      await tx.execution.update({ where: { id: executionId }, data: waiting });
    });
    return 'waiting';
  }

  // Continues a message sequence after an item was sent (or failed for good) or a pause elapsed.
  private async resumeSequence(execution: { id: string; workspaceId: string; conversationId: string }, job: AutomationJob, pending: PendingSequence, context: EngineContext, definition: AutomationDefinition): Promise<{ context: EngineContext; nextNodeId: string } | null> {
    const step = await this.prisma.executionStep.findUnique({ where: { id: pending.stepId } });
    const node = step && definition.nodes.find(item => item.id === step.nodeId);
    if (!step || !node) {
      await this.failExecution(execution.id, 'NODE_NOT_FOUND', 'O nó da mensagem não foi encontrado.');
      return null;
    }
    if (job.failedIndex !== undefined) {
      await this.prisma.executionStep.update({ where: { id: step.id }, data: { status: 'FAILED', reason: `MESSAGE_ITEM_FAILED: item ${job.failedIndex + 1}`, finishedAt: new Date() } });
      await this.failExecution(execution.id, 'MESSAGE_ITEM_FAILED', `Falha ao enviar o item ${job.failedIndex + 1} da mensagem.`);
      return null;
    }
    const nextNodeId = selectNextEdge(node, definition.edges, context)?.target;
    await this.prisma.execution.update({ where: { id: execution.id }, data: { status: 'RUNNING', context: asJson(context) } });
    try {
      const result = await this.runSequenceItem(execution.id, execution.workspaceId, execution.conversationId, step, node, context, job.sequenceIndex!, this.messageItems(node), nextNodeId);
      if (result === 'waiting') return null;
    } catch (error) {
      await this.failStep(execution.id, step.id, node.id, error);
      throw error;
    }
    if (nextNodeId) return { context:stableContext(context), nextNodeId };
    await this.succeedExecution(execution.id, context);
    return null;
  }

  private async failStep(executionId: string, stepId: string, nodeId: string, error: unknown) {
    const code = error instanceof NodeExecutionError ? error.code : 'NODE_EXECUTION_FAILED';
    const message = error instanceof Error ? error.message : 'Falha desconhecida durante a execução do nó.';
    await this.prisma.$transaction([
      this.prisma.executionStep.update({ where: { id: stepId }, data: { status: 'FAILED', reason: `${code}: ${message}`.slice(0, 1000), finishedAt: new Date() } }),
      this.prisma.execution.update({ where: { id: executionId }, data: { status: 'FAILED', currentNode: nodeId, finishedAt: new Date() } })
    ]);
  }

  private resumeWait(executionId: string, conversationId: string, job: AutomationJob, pending: PendingWait, context: EngineContext, definition: AutomationDefinition) {
    return pending.kind === 'reply'
      ? this.resumeReply(executionId, conversationId, job, pending, context, definition)
      : this.resumeMenu(executionId, conversationId, job, pending, context, definition);
  }

  // Applies the reply (every inbound message since the wait began, so a buffered job sees them all) or the expiry
  // to a wait_response. Returns null when the execution must stay as it is or has already been finished here.
  private async resumeReply(executionId: string, conversationId: string, job: AutomationJob, pending: PendingWait, context: EngineContext, definition: AutomationDefinition): Promise<{ context: EngineContext; nextNodeId: string } | null> {
    const node = definition.nodes.find(item => item.id === pending.nodeId);
    if (!node || node.kind !== 'wait_response') {
      await this.failExecution(executionId, 'NODE_NOT_FOUND', `Aguarda Resposta ${pending.nodeId} não encontrado.`);
      return null;
    }
    let next=stableContext(context);
    const since = pending.since ? new Date(pending.since) : (await this.prisma.executionStep.findUnique({ where: { id: pending.stepId }, select: { startedAt: true } }))?.startedAt ?? new Date(0);
    const messages = await this.prisma.message.findMany({ where: { conversationId, direction: 'INBOUND', createdAt: { gte: since } }, orderBy: { createdAt: 'asc' }, select: { id: true, body: true, type: true,externalId:true } });
    // A reply that arrived before the timeout wins even when its buffered job has not fired yet.
    if (job.action === 'menu_timeout' && !messages.length) {
      await this.prisma.executionStep.update({ where: { id: pending.stepId }, data: { status: 'SUCCEEDED', output: { timedOut: true }, finishedAt: new Date() } });
      const edge = selectPortEdge(definition.edges, node.id, 'timeout');
      if (edge && !waitTimeoutSeconds(node.config).endsWithoutTimeoutRoute) return { context: next, nextNodeId: edge.target };
      await this.prisma.execution.update({ where: { id: executionId }, data: { status: 'SUCCEEDED', currentNode: null, finishedAt: new Date(), context: asJson(next) } });
      return null;
    }
    if (!messages.length) return null;
    const reply = joinReplies(messages);
    const messageIds = messages.map(message => message.id);
    next = setContextPath(setContextPath(setContextPath(next, 'last_message', reply.last_message), 'last_message_type', reply.last_message_type), 'wait.messageIds', messageIds);
    const config=AutomationWaitResponseConfigSchema.parse(node.config);
    const latest=messages[messages.length-1]!;
    const actions=waitReplyActions(config,reply,latest);
    if(actions.quoteNext)next={...next,_runtime:{...stableRuntime(next),quoteNext:actions.quoteNext}};
    const conversation=await this.prisma.conversation.findFirst({where:{id:conversationId},select:{workspaceId:true,channelId:true,contact:{select:{id:true,phone:true,externalRef:true}}}});
    await this.prisma.$transaction(async tx=>{
      // Sets only this key in SQL so concurrent writers of other custom fields are not overwritten; a non-object value resets to {} as before.
      if(actions.saveReply&&conversation)await tx.$executeRaw`UPDATE "Contact" SET "customFields" = jsonb_set(CASE WHEN jsonb_typeof("customFields") = 'object' THEN "customFields" ELSE '{}'::jsonb END, ARRAY[${actions.saveReply.field}]::text[], to_jsonb(${actions.saveReply.value}::text), true), "updatedAt" = now() WHERE "id" = ${conversation.contact.id} AND "workspaceId" = ${conversation.workspaceId}`;
      if(actions.reaction&&conversation)await tx.outboxEvent.create({data:{workspaceId:conversation.workspaceId,aggregate:'Message',aggregateId:latest.id,type:'reaction.send.requested',payload:{channelId:conversation.channelId,phone:conversation.contact.externalRef??conversation.contact.phone,messageExternalId:actions.reaction.messageExternalId,emoji:actions.reaction.emoji}}});
      await tx.executionStep.update({ where: { id: pending.stepId }, data: { status: 'SUCCEEDED', output: { messageIds, last_message_type: reply.last_message_type,savedTo:actions.saveReply?.field??null,reactionQueued:Boolean(actions.reaction) }, finishedAt: new Date() } });
    });
    const edge = selectPortEdge(definition.edges, node.id, 'reply');
    if (edge) return { context: next, nextNodeId: edge.target };
    await this.succeedExecution(executionId, next);
    return null;
  }

  // Applies the contact's answer (or the expiry) to a waiting menu. Returns null when the execution
  // must stay as it is: an unrelated message keeps the menu waiting.
  private async resumeMenu(executionId: string, conversationId: string, job: AutomationJob, pending: PendingWait, context: EngineContext, definition: AutomationDefinition): Promise<{ context: EngineContext; nextNodeId: string } | null> {
    const node = definition.nodes.find(item => item.id === pending.nodeId);
    if (!node || node.kind !== 'buttons') {
      await this.failExecution(executionId, 'NODE_NOT_FOUND', `Menu ${pending.nodeId} não encontrado.`);
      return null;
    }
    let next=stableContext(context);
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
    // No exit wired for this option or for inactivity: the journey simply ends here.
    await this.succeedExecution(executionId, next);
    return null;
  }

  // Right after a wait, read what ended the wait (preferring media this block understands), not whatever arrived
  // since: a receipt followed a second later by "segue o comprovante" must still reach the AI as an image.
  private async aiSourceMessage(executionId: string, stepId: string, workspaceId: string, conversationId: string, context: EngineContext, config: Record<string, unknown>) {
    const ids = (context.wait as { messageIds?: unknown } | undefined)?.messageIds;
    const previous = Array.isArray(ids) && ids.length ? await this.prisma.executionStep.findFirst({ where: { executionId, id: { not: stepId } }, orderBy: { startedAt: 'desc' }, select: { kind: true } }) : null;
    if (previous?.kind !== 'wait_response') return this.prisma.message.findFirst({ where: { workspaceId, conversationId, direction: 'INBOUND' }, orderBy: { createdAt: 'desc' } });
    const waitIds = (ids as unknown[]).filter((id): id is string => typeof id === 'string');
    const mediaTypes = [...(config.understandImage === true || config.identifyReceipt === true ? ['IMAGE'] : []), ...(config.understandPdf === true || config.identifyReceipt === true ? ['DOCUMENT'] : []), ...(config.understandAudio === true ? ['AUDIO'] : [])];
    const where = { workspaceId, conversationId, direction: 'INBOUND' as const, id: { in: waitIds } };
    return (mediaTypes.length ? await this.prisma.message.findFirst({ where: { ...where, type: { in: mediaTypes as never } }, orderBy: { createdAt: 'desc' } }) : null)
      ?? await this.prisma.message.findFirst({ where, orderBy: { createdAt: 'desc' } });
  }

  // A block with no exit ends the flow, as in Leona.
  private async succeedExecution(executionId: string, context?: EngineContext) {
    await this.prisma.execution.updateMany({ where: { id: executionId, status: { in: ['RUNNING', 'WAITING'] } }, data: { status: 'SUCCEEDED', currentNode: null, finishedAt: new Date(), ...(context ? { context: asJson(context) } : {}) } });
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
        include: { workspace: { select: { timezone: true } }, contact: { include: { tags: { include: { tag: true } },kanbanCards:{select:{boardId:true,columnId:true}} } } }
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
      lastInboundAt: lastInbound?.createdAt ?? null,
      kanban: contact.kanbanCards
    });
  }

  private loadExecution(executionId: string) {
    return this.prisma.execution.findUnique({ where: { id: executionId }, include: { playbookVersion: true } });
  }

  async onModuleDestroy() { await this.queue.close(); }
}
