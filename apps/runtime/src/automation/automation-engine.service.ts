import { randomUUID } from 'node:crypto';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, type ExecutionStep } from '@prisma/client';
import { Queue } from 'bullmq';
import { AutomationDefinitionSchema } from '@nexo/contracts';
import { PrismaService } from '../infra/prisma.service.js';
import { RedisService } from '../infra/redis.service.js';
import { renderTemplate, selectNextEdge, type AutomationDefinition, type AutomationNode } from './routing.js';
import { AgentRuntimeService } from '../agent/agent-runtime.service.js';

const AUTOMATION_QUEUE = 'automation.execute';
const RELEASE_LOCK = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
const outcomeTypes = new Set(['QUALIFIED', 'APPOINTMENT', 'SALE', 'RESOLVED', 'HANDOFF', 'DISQUALIFIED']);

export type AutomationJob = { executionId: string; action?: 'start' | 'resume'; resumeStepId?: string };
type RuntimeState = { pendingDelayStepId?: string; error?: { code: string; message: string } };
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
      if (job.action !== 'resume' || !job.resumeStepId || context._runtime?.pendingDelayStepId !== job.resumeStepId) return;
      context = { ...context, _runtime: {} };
      await this.prisma.execution.update({ where: { id: execution.id }, data: { status: 'RUNNING', context: asJson(context) } });
    }

    const parsed = AutomationDefinitionSchema.safeParse(execution.playbookVersion.definition);
    if (!parsed.success) {
      await this.failExecution(execution.id, 'INVALID_DEFINITION', parsed.error.message);
      return;
    }
    const definition = parsed.data;
    const nodes = new Map(definition.nodes.map(node => [node.id, node]));
    let currentNodeId: string | undefined = execution.currentNode ?? definition.start;
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
      const edge = selectNextEdge(node, definition.edges, context);
      const nextNodeId = edge?.target;
      let step = await this.prisma.executionStep.findFirst({ where: { executionId: execution.id, nodeId: node.id, status: 'RUNNING' }, orderBy: { startedAt: 'desc' } });
      step ??= await this.prisma.executionStep.create({ data: { executionId: execution.id, nodeId: node.id, kind: node.kind, status: 'RUNNING', input: asJson({ context, selectedEdgeId: edge?.id ?? null }) } });
      try {
        const result = await this.runNode({ executionId: execution.id, workspaceId: execution.workspaceId, conversationId: execution.conversationId, context, definition, node, step, nextNodeId });
        if (result === 'waiting' || result === 'terminal') return;
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
      currentNodeId = nextNodeId;
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
  }): Promise<'continue' | 'waiting' | 'terminal'> {
    const { executionId, workspaceId, conversationId, context, node, step, nextNodeId } = input;
    if (!['handoff', 'outcome'].includes(node.kind) && !nextNodeId) throw new NodeExecutionError('DEAD_END', `O nó ${node.id} não possui uma saída válida.`);

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
        const rawUrl = typeof node.config.url === 'string' ? renderTemplate(node.config.url, context).trim() : '';
        if (node.kind !== 'buttons' && !rawUrl.startsWith('https://')) throw new NodeExecutionError('MEDIA_HTTPS_REQUIRED', 'A mídia precisa usar uma URL HTTPS.');
        const body = node.kind === 'image'
          ? (typeof node.config.caption === 'string' ? renderTemplate(node.config.caption, context) : null)
          : node.kind === 'buttons' ? renderTemplate(stringConfig(node, 'text'), context) : null;
        const buttons = node.kind === 'buttons' && Array.isArray(node.config.buttons)
          ? node.config.buttons.map(item => {
              const button = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
              return {
                id: typeof button.id === 'string' ? button.id : '',
                label: typeof button.label === 'string' ? renderTemplate(button.label, context) : ''
              };
            })
          : undefined;
        const messageType = node.kind === 'audio' ? 'AUDIO' : node.kind === 'buttons' ? 'TEMPLATE' : 'IMAGE';
        const providerPayload = node.kind === 'buttons'
          ? { kind: 'buttons', buttons, ...(typeof node.config.footer === 'string' && node.config.footer.trim() ? { footer: renderTemplate(node.config.footer, context) } : {}) }
          : node.kind === 'sticker' ? { kind: 'sticker' }
          : node.kind === 'audio' ? { kind: 'audio', ptt: node.config.ptt === true }
          : { kind: 'image' };
        await this.prisma.$transaction(async tx => {
          const message = await tx.message.create({ data: { workspaceId, conversationId, direction: 'OUTBOUND', type: messageType, status: 'PENDING', body, mediaUrl: rawUrl || null, providerPayload: asJson(providerPayload), authorType: 'automation', authorId: executionId } });
          await tx.outboxEvent.create({ data: { workspaceId, aggregate: 'Message', aggregateId: message.id, type: 'message.send.requested', payload: { messageId: message.id } } });
          await this.finishInTransaction(tx, executionId, step.id, nextNodeId, context, { messageId: message.id, kind: node.kind });
        });
        return 'continue';
      }

      case 'delay': {
        const seconds = node.config.seconds;
        if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 1 || seconds > 2_592_000) throw new NodeExecutionError('INVALID_DELAY', 'A espera deve ter entre 1 segundo e 30 dias.');
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
        let tagId = typeof node.config.tagId === 'string' ? node.config.tagId : undefined;
        await this.prisma.$transaction(async tx => {
          if (tagId) {
            if (!await tx.tag.count({ where: { id: tagId, workspaceId } })) throw new NodeExecutionError('TAG_NOT_FOUND', 'A etiqueta configurada não existe.');
          } else {
            const name = stringConfig(node, 'tag');
            const tag = await tx.tag.upsert({ where: { workspaceId_name: { workspaceId, name } }, create: { workspaceId, name }, update: {} });
            tagId = tag.id;
          }
          const alreadyTagged = await tx.contactTag.count({ where: { contactId: conversation.contactId, tagId: tagId! } });
          await tx.contactTag.upsert({ where: { contactId_tagId: { contactId: conversation.contactId, tagId: tagId! } }, create: { contactId: conversation.contactId, tagId: tagId! }, update: {} });
          if (!alreadyTagged) await tx.outboxEvent.create({ data: { workspaceId, aggregate: 'Contact', aggregateId: conversation.contactId, type: 'automation.trigger.requested', payload: { event: 'tag.added', conversationId, contactId: conversation.contactId, tagId: tagId! } } });
          await this.finishInTransaction(tx, executionId, step.id, nextNodeId, context, { tagId });
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

      case 'webhook': {
        const url = stringConfig(node, 'url');
        if (!url.startsWith('https://')) throw new NodeExecutionError('WEBHOOK_HTTPS_REQUIRED', 'O webhook deve usar HTTPS.');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Math.min(input.definition.settings.timeoutSeconds * 1000, 30_000));
        try {
          const response = await fetch(url, { method: typeof node.config.method === 'string' ? node.config.method.toUpperCase() : 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': step.id }, body: JSON.stringify({ executionId, conversationId, context }), signal: controller.signal });
          const body = (await response.text()).slice(0, 10_000);
          if (!response.ok) throw new NodeExecutionError('WEBHOOK_FAILED', `Webhook respondeu HTTP ${response.status}.`);
          const nextContext = { ...context, webhook: { status: response.status, body } };
          await this.completeStep(executionId, step.id, nextNodeId, nextContext, { status: response.status, body });
        } finally {
          clearTimeout(timeout);
        }
        return 'continue';
      }

      case 'agent': {
        const agentId = typeof node.config.agentId === 'string' ? node.config.agentId : '';
        const inbound = await this.prisma.message.findFirst({where:{conversationId,direction:'INBOUND'},orderBy:{createdAt:'desc'},select:{body:true}});
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

  private async completeStep(executionId: string, stepId: string, nextNodeId: string | undefined, context: EngineContext, output: Prisma.InputJsonValue) {
    await this.prisma.$transaction(async tx => this.finishInTransaction(tx, executionId, stepId, nextNodeId, context, output));
  }

  private async finishInTransaction(tx: Prisma.TransactionClient, executionId: string, stepId: string, nextNodeId: string | undefined, context: EngineContext, output: Prisma.InputJsonValue) {
    await tx.executionStep.update({ where: { id: stepId }, data: { status: 'SUCCEEDED', output, finishedAt: new Date() } });
    await tx.execution.update({ where: { id: executionId }, data: { currentNode: nextNodeId, context: asJson(context) } });
  }

  private async failExecution(executionId: string, code: string, message: string) {
    const execution = await this.prisma.execution.findUnique({ where: { id: executionId }, select: { context: true } });
    if (!execution) return;
    const context = objectContext(execution.context);
    await this.prisma.execution.updateMany({ where: { id: executionId, status: { in: ['RUNNING', 'WAITING'] } }, data: { status: 'FAILED', finishedAt: new Date(), context: asJson({ ...context, _runtime: { ...context._runtime, error: { code, message } } }) } });
  }

  private loadExecution(executionId: string) {
    return this.prisma.execution.findUnique({ where: { id: executionId }, include: { playbookVersion: true } });
  }

  async onModuleDestroy() { await this.queue.close(); }
}
