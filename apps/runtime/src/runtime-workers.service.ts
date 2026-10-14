import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import pino from 'pino';
import { PrismaService } from './infra/prisma.service.js';
import { RedisService } from './infra/redis.service.js';
import { QUEUES, type AutomationJob, type ConnectionJob, type OutboundJob } from './queues.js';
import { WhatsAppSessionManager } from './whatsapp/session-manager.service.js';
import { outboundMessageId } from './whatsapp/message-id.js';
import { AutomationEngineService } from './automation/automation-engine.service.js';
import { KnowledgeIndexerService } from './knowledge/knowledge-indexer.service.js';
import { interactivePayload, regularOutboundContent, sendInteractiveButtons } from './whatsapp/outbound-content.js';
import { matchesAutomationTrigger } from './automation/trigger.js';

@Injectable()
export class RuntimeWorkers implements OnModuleInit, OnModuleDestroy {
  private readonly workers: Worker[] = [];
  private readonly queues: Queue[] = [];
  private readonly logger = pino().child({ module: 'runtime-workers' });
  private outboxTimer?: NodeJS.Timeout;
  private relayingOutbox = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sessions: WhatsAppSessionManager,
    private readonly automation: AutomationEngineService,
    private readonly knowledge: KnowledgeIndexerService
  ) {}

  async onModuleInit() {
    const connectionWorker = new Worker<ConnectionJob>(QUEUES.whatsappConnection, job => this.handleConnection(job), {
      connection: this.redis,
      concurrency: 10
    });
    const outboundWorker = new Worker<OutboundJob>(QUEUES.whatsappOutbound, job => this.handleOutbound(job), {
      connection: this.redis,
      concurrency: 20,
      limiter: { max: 20, duration: 1_000 }
    });
    const automationWorker = new Worker<AutomationJob>(QUEUES.automationExecute, job => this.automation.execute(job.data), {
      connection: this.redis,
      concurrency: 20
    });
    this.workers.push(connectionWorker, outboundWorker, automationWorker);
    for (const worker of this.workers) worker.on('failed', (job, error) => this.logger.error({ jobId: job?.id, err: error }, 'job failed'));

    const outboundQueue = new Queue<OutboundJob>(QUEUES.whatsappOutbound, { connection: this.redis });
    const connectionQueue = new Queue<ConnectionJob>(QUEUES.whatsappConnection, { connection: this.redis });
    const automationQueue = new Queue<AutomationJob>(QUEUES.automationExecute, { connection: this.redis });
    this.queues.push(outboundQueue, connectionQueue, automationQueue);

    this.outboxTimer = setInterval(() => { void this.relayOutbox(outboundQueue, automationQueue); }, 1_000);
    this.outboxTimer.unref();
    await this.resumeChannels(connectionQueue);
  }

  private async handleConnection(job: Job<ConnectionJob>) {
    if (job.data.action === 'disconnect') {
      await this.sessions.disconnect(job.data.channelId, job.data.removeAuth ?? false);
      return;
    }
    await this.sessions.connect(job.data.channelId, job.data.pairingPhoneNumber);
  }

  private async handleOutbound(job: Job<OutboundJob>) {
    const message = await this.prisma.message.findUnique({
      where: { id: job.data.messageId },
      include: { conversation: { include: { contact: true, channel: true } } }
    });
    if (!message || message.direction !== 'OUTBOUND') return;
    if (['SENT', 'DELIVERED', 'READ'].includes(message.status)) return;
    const { channel, contact } = message.conversation;
    if (channel.provider !== 'baileys') throw new Error(`Channel ${channel.id} is not managed by Baileys`);
    let socket = this.sessions.getSocket(channel.id);
    if (!socket) {
      await this.sessions.connect(channel.id);
      socket = this.sessions.getSocket(channel.id);
    }
    if (!socket) throw new Error(`WhatsApp session ${channel.id} is owned by another worker or unavailable`);
    const jid = contact.externalRef?.includes('@')
      ? contact.externalRef
      : `${contact.phone.replace(/\D/g, '')}@s.whatsapp.net`;
    try {
      const messageId = outboundMessageId(message.clientRequestId ?? message.id);
      const content = regularOutboundContent(message);
      const externalId = content
        ? (await socket.sendMessage(jid, content, { messageId }))?.key.id
        : await sendInteractiveButtons({
            socket,
            jid,
            messageId,
            text: message.body ?? '',
            ...interactivePayload(message.providerPayload)
          });
      await this.prisma.message.update({
        where: { id: message.id },
        data: { externalId: externalId ?? message.externalId, status: 'SENT', sentAt: new Date(), errorCode: null }
      });
    } catch (error) {
      await this.prisma.message.update({
        where: { id: message.id },
        data: { status: 'FAILED', errorCode: error instanceof Error ? error.message.slice(0, 200) : 'SEND_FAILED' }
      });
      throw error;
    }
  }

  private async relayOutbox(outboundQueue: Queue<OutboundJob>, automationQueue: Queue<AutomationJob>) {
    if (this.relayingOutbox) return;
    this.relayingOutbox = true;
    try {
    const events = await this.prisma.outboxEvent.findMany({
      where: { type: { in: ['message.send.requested', 'automation.execution.requested', 'automation.inbound.received', 'automation.trigger.requested', 'knowledge.index.requested'] }, processedAt: null, availableAt: { lte: new Date() }, attempts: { lt: 10 } },
      take: 50,
      orderBy: { createdAt: 'asc' }
    });
    for (const event of events) {
      const payload = event.payload as { messageId?: string; executionId?: string; conversationId?: string; contactId?:string; tagId?:string; event?:string; sourceId?:string; content?:string|null };
      const valid = event.type === 'message.send.requested' ? Boolean(payload.messageId)
        : event.type === 'automation.inbound.received' ? Boolean(payload.conversationId)
        : event.type === 'automation.trigger.requested' ? Boolean(payload.event && (payload.conversationId || payload.contactId))
        : event.type === 'knowledge.index.requested'?Boolean(payload.sourceId):Boolean(payload.executionId);
      if (!valid) {
        await this.prisma.outboxEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
        continue;
      }
      try {
        const commonOptions = {
          jobId: `outbox-${event.id}`,
          attempts: 8,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: { age: 86_400, count: 10_000 },
          removeOnFail: { age: 604_800, count: 10_000 }
        };
        if(event.type==='knowledge.index.requested'){
          await this.knowledge.index(payload.sourceId!,payload.content??null);
        } else if (event.type === 'automation.inbound.received' || event.type === 'automation.trigger.requested') {
          await this.startTriggeredExecution(automationQueue, {
            triggerEvent: event.type === 'automation.inbound.received' ? 'message.received' : payload.event!,
            conversationId: payload.conversationId,
            contactId: payload.contactId,
            messageId: payload.messageId,
            tagId: payload.tagId,
            jobOptions: commonOptions
          });
        } else if (event.type === 'automation.execution.requested') {
          await automationQueue.add('start', { executionId: payload.executionId!, action: 'start' }, commonOptions);
        } else {
          await outboundQueue.add('send', { messageId: payload.messageId! }, commonOptions);
        }
        await this.prisma.outboxEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
      } catch {
        const attempts = event.attempts + 1;
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { attempts, availableAt: new Date(Date.now() + Math.min(3_600, 2 ** attempts) * 1_000) }
        });
      }
    }
    } finally {
      this.relayingOutbox = false;
    }
  }

  private async startTriggeredExecution(automationQueue: Queue<AutomationJob>, input: {triggerEvent:string;conversationId?:string;contactId?:string;messageId?:string;tagId?:string;jobOptions:Record<string,unknown>}) {
    const include = { contact: { include: { tags: { include: { tag: true } } } }, channel: { include: { activePlaybook: { include: { activeVersion: true } } } } } as const;
    const conversation = input.conversationId
      ? await this.prisma.conversation.findUnique({ where: { id: input.conversationId }, include })
      : await this.prisma.conversation.findFirst({ where: { contactId: input.contactId!, status: { not: 'RESOLVED' }, channel: { activePlaybookId: { not: null } } }, include, orderBy: { updatedAt: 'desc' } });
    const version = conversation?.channel.activePlaybook?.activeVersion;
    if (!conversation || !version) return;
    if (!matchesAutomationTrigger(version.definition, input.triggerEvent, input.tagId)) return;
    const active = await this.prisma.execution.findFirst({ where: { conversationId: conversation.id, playbookVersionId: version.id, status: { in: ['RUNNING', 'WAITING'] } } });
    if (active) return;
    if (!await this.canStartExecution(conversation.workspaceId)) {
      await this.prisma.$transaction([
        this.prisma.conversation.update({where:{id:conversation.id},data:{mode:'HUMAN',status:'QUEUED'}}),
        this.prisma.auditLog.create({data:{workspaceId:conversation.workspaceId,action:'billing.execution_quota_handoff',targetType:'Conversation',targetId:conversation.id,changes:{reason:'executionsMonthly'}}})
      ]);
      return;
    }
    const execution = await this.prisma.execution.create({ data: {
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      playbookVersionId: version.id,
      context: {
        trigger: { event: input.triggerEvent, messageId: input.messageId ?? null, tagId: input.tagId ?? null },
        contact: { id: conversation.contact.id, name: conversation.contact.name, phone: conversation.contact.phone, email: conversation.contact.email, stage: conversation.contact.stage, customFields: conversation.contact.customFields, tags: conversation.contact.tags.map(item => ({ id: item.tag.id, name: item.tag.name })) },
        conversation: { id: conversation.id, status: conversation.status, mode: conversation.mode }
      }
    } });
    await automationQueue.add('start', { executionId: execution.id, action: 'start' }, input.jobOptions);
  }

  private async canStartExecution(workspaceId:string){const subscription=await this.prisma.subscription.findFirst({where:{workspaceId,status:{in:['active','trialing']}},orderBy:{currentPeriodEnd:'desc'}});const raw=subscription?.limits&&typeof subscription.limits==='object'&&!Array.isArray(subscription.limits)?subscription.limits as Record<string,unknown>:{};const configured=[raw.executionsMonthly,raw.executions,raw.conversations].find(value=>typeof value==='number'&&value>=0);const limit=typeof configured==='number'?Math.floor(configured):subscription?.plan==='growth'?5_000:subscription?.plan==='scale'?50_000:500;const from=subscription?.currentPeriodStart??new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth(),1));return await this.prisma.execution.count({where:{workspaceId,startedAt:{gte:from}}})<limit}

  private async resumeChannels(queue: Queue<ConnectionJob>) {
    const channels = await this.prisma.channel.findMany({
      where: { provider: 'baileys', status: { in: ['PENDING', 'CONNECTED', 'DEGRADED'] } },
      select: { id: true }
    });
    await Promise.all(channels.map(channel => queue.add('connect', { channelId: channel.id, action: 'connect' }, {
      jobId: `startup-${channel.id}-${Date.now()}`,
      removeOnComplete: 100,
      removeOnFail: 500
    })));
  }

  async onModuleDestroy() {
    if (this.outboxTimer) clearInterval(this.outboxTimer);
    await Promise.all(this.workers.map(worker => worker.close()));
    await Promise.all(this.queues.map(queue => queue.close()));
  }
}
