import { Inject,Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DelayedError, Job, Queue, Worker } from 'bullmq';
import {proto} from '@whiskeysockets/baileys';
import pino from 'pino';
import { PrismaService } from './infra/prisma.service.js';
import { RedisService } from './infra/redis.service.js';
import { QUEUES, type AutomationJob, type ConnectionJob, type OutboundJob } from './queues.js';
import { WhatsAppSessionManager } from './whatsapp/session-manager.service.js';
import { outboundMessageId } from './whatsapp/message-id.js';
import { AutomationEngineService } from './automation/automation-engine.service.js';
import { KnowledgeIndexerService } from './knowledge/knowledge-indexer.service.js';
import { interactivePayload, outboundPresence,playbookAssetId,regularOutboundContent, sendInteractiveButtons } from './whatsapp/outbound-content.js';
import { firstName } from './automation/live-context.js';
import { MEDIA_RETENTION_MS } from './whatsapp/message-content.js';
import { acceptsNewEntrants, isOncePerContact, matchesAutomationTrigger, shouldStartForContact } from './automation/trigger.js';
import { pendingWaitOf, waitBufferSeconds } from './automation/wait-response.js';
import { sequenceJobOptions, sequenceOf } from './automation/message-sequence.js';

@Injectable()
export class RuntimeWorkers implements OnModuleInit, OnModuleDestroy {
  private readonly workers: Worker[] = [];
  private readonly queues: Queue[] = [];
  private readonly logger = pino().child({ module: 'runtime-workers' });
  private outboxTimer?: NodeJS.Timeout;
  private mediaTimer?: NodeJS.Timeout;
  private relayingOutbox = false;
  private automationQueue!: Queue<AutomationJob>;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(WhatsAppSessionManager) private readonly sessions: WhatsAppSessionManager,
    @Inject(AutomationEngineService) private readonly automation: AutomationEngineService,
    @Inject(KnowledgeIndexerService) private readonly knowledge: KnowledgeIndexerService
  ) {}

  async onModuleInit() {
    const outboundQueue = new Queue<OutboundJob>(QUEUES.whatsappOutbound, { connection: this.redis });
    const connectionQueue = new Queue<ConnectionJob>(QUEUES.whatsappConnection, { connection: this.redis });
    const automationQueue = this.automationQueue = new Queue<AutomationJob>(QUEUES.automationExecute, { connection: this.redis });
    this.queues.push(outboundQueue, connectionQueue, automationQueue);
    const connectionWorker = new Worker<ConnectionJob>(QUEUES.whatsappConnection, job => this.handleConnection(job), {
      connection: this.redis,
      concurrency: 10
    });
    const outboundWorker = new Worker<OutboundJob>(QUEUES.whatsappOutbound, (job, token) => this.handleOutbound(job, token), {
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

    this.outboxTimer = setInterval(() => { void this.relayOutbox(outboundQueue, automationQueue); }, 1_000);
    this.outboxTimer.unref();
    void this.purgeExpiredMedia();
    this.mediaTimer = setInterval(() => { void this.purgeExpiredMedia(); }, 6 * 3_600_000);
    this.mediaTimer.unref();
    await this.resumeChannels(connectionQueue);
  }

  private async handleConnection(job: Job<ConnectionJob>) {
    if (job.data.action === 'disconnect') {
      await this.sessions.disconnect(job.data.channelId, job.data.removeAuth ?? false);
      return;
    }
    await this.sessions.connect(job.data.channelId, job.data.pairingPhoneNumber);
  }

  private async handleOutbound(job: Job<OutboundJob>, token?: string) {
    try {
      await this.sendOutbound(job, token);
    } catch (error) {
      // On the last outbound attempt, persist provider failure or durably retry a
      // continuation failure so the execution cannot remain WAITING forever.
      if (!(error instanceof DelayedError) && job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        if(!job.data.messageId)throw error;
        const message = await this.prisma.message.findUnique({ where: { id: job.data.messageId }, select: { providerPayload: true, status: true } });
        const sequence = sequenceOf(message?.providerPayload);
        const execution = sequence ? await this.prisma.execution.findUnique({ where: { id: sequence.executionId }, select: { context: true, workspaceId: true } }) : null;
        if (sequence && message?.status === 'FAILED') {
          const reason = `MESSAGE_ITEM_FAILED: item ${sequence.index + 1}`;
          const context = execution?.context && typeof execution.context === 'object' && !Array.isArray(execution.context) ? execution.context as Record<string, unknown> : {};
          const runtime = context._runtime && typeof context._runtime === 'object' && !Array.isArray(context._runtime) ? context._runtime as Record<string, unknown> : {};
          await this.prisma.$transaction([
            this.prisma.executionStep.updateMany({ where: { id: sequence.stepId, executionId: sequence.executionId, status: 'RUNNING' }, data: { status: 'FAILED', reason, finishedAt: new Date() } }),
            this.prisma.execution.updateMany({ where: { id: sequence.executionId, status: 'WAITING' }, data: { status: 'FAILED', finishedAt: new Date(), context: { ...context, _runtime: { ...runtime, error: { code: 'MESSAGE_ITEM_FAILED', message: `Falha ao enviar o item ${sequence.index + 1} da mensagem.` } } } as Prisma.InputJsonValue } })
          ]);
        } else if (sequence && message && ['SENT', 'DELIVERED', 'READ'].includes(message.status) && execution) {
          // The provider send succeeded, but enqueueing its continuation did not. Keep a
          // durable retry in the outbox instead of either resending or stranding the flow.
          await this.prisma.outboxEvent.create({ data: {
            workspaceId: execution.workspaceId, aggregate: 'Execution', aggregateId: sequence.executionId, type: 'automation.sequence.continue.requested',
            payload: { executionId: sequence.executionId, resumeStepId: sequence.stepId, sequenceIndex: sequence.index + 1 }
          } });
        }
      }
      throw error;
    }
  }

  private async sendOutbound(job: Job<OutboundJob>, token?: string) {
    if(job.data.reaction){
      const {channelId,phone,messageExternalId,emoji}=job.data.reaction;const channel=await this.prisma.channel.findUnique({where:{id:channelId}});if(!channel||channel.provider!=='baileys')throw new Error('Reaction channel is unavailable');
      let socket=this.sessions.getSocket(channelId);if(!socket){await this.sessions.connect(channelId);socket=this.sessions.getSocket(channelId)}if(!socket)throw new Error(`WhatsApp session ${channelId} is unavailable`);
      const jid=phone.includes('@')?phone:`${phone.replace(/\D/g,'')}@s.whatsapp.net`;
      await socket.sendMessage(jid,{react:{text:emoji,key:{remoteJid:jid,fromMe:false,id:messageExternalId}}});return;
    }
    if(job.data.notification){
      const {channelId,phone,text}=job.data.notification;const channel=await this.prisma.channel.findUnique({where:{id:channelId}});if(!channel||channel.provider!=='baileys')throw new Error('Notification channel is unavailable');
      let socket=this.sessions.getSocket(channelId);if(!socket){await this.sessions.connect(channelId);socket=this.sessions.getSocket(channelId)}if(!socket)throw new Error(`WhatsApp session ${channelId} is unavailable`);
      await socket.sendMessage(`${phone.replace(/\D/g,'')}@s.whatsapp.net`,{text});return;
    }
    if(!job.data.messageId)return;
    const message = await this.prisma.message.findUnique({
      where: { id: job.data.messageId },
      include: { conversation: { include: { contact: true, channel: true } } }
    });
    if (!message || message.direction !== 'OUTBOUND') return;
    const sequence = sequenceOf(message.providerPayload);
    // Re-scheduling is idempotent (fixed jobId), so a retry after SENT still releases the next item.
    const continueSequence = async () => { if (sequence) await this.automationQueue.add('sequence_next', { executionId: sequence.executionId, action: 'sequence_next', resumeStepId: sequence.stepId, sequenceIndex: sequence.index + 1 }, sequenceJobOptions(sequence.stepId, sequence.index + 1)); };
    if (['SENT', 'DELIVERED', 'READ'].includes(message.status)) return continueSequence();
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
    const payload = message.providerPayload && typeof message.providerPayload === 'object' && !Array.isArray(message.providerPayload) ? message.providerPayload as { typingSeconds?: unknown;quotedMessageId?:unknown } : {};
    const typingSeconds = typeof payload.typingSeconds === 'number' ? payload.typingSeconds : 0;
    if (typingSeconds > 0 && !job.data.typed) {
      await socket.sendPresenceUpdate(outboundPresence(message.type,typingSeconds)!, jid);
      await job.updateData({ ...job.data, typed: true });
      await job.moveToDelayed(Date.now() + typingSeconds * 1000, token);
      throw new DelayedError();
    }
    try {
      const messageId = outboundMessageId(message.clientRequestId ?? message.id);
      const assetId=playbookAssetId(message.mediaUrl);
      const stored=assetId?await this.prisma.playbookAsset.findFirst({where:{id:assetId,workspaceId:message.workspaceId},select:{data:true,contentType:true,fileName:true}}):null;
      if(assetId&&!stored)throw new Error('PLAYBOOK_ASSET_NOT_FOUND');
      const asset=stored?{...stored,data:Buffer.from(stored.data)}:null;
      const content = regularOutboundContent(message,asset);
      const quotedSource=typeof payload.quotedMessageId==='string'?await this.prisma.message.findFirst({where:{id:payload.quotedMessageId,conversationId:message.conversationId,direction:'INBOUND'},select:{externalId:true,body:true}}):null;
      const quoted=quotedSource?.externalId?proto.WebMessageInfo.create({key:{remoteJid:jid,fromMe:false,id:quotedSource.externalId},message:{conversation:quotedSource.body??'Mídia'}}):undefined;
      const externalId = content
        ? (await socket.sendMessage(jid, content, { messageId,...(quoted?{quoted}:{}) }))?.key.id
        : await sendInteractiveButtons({
            socket,
            jid,
            messageId,
            text: message.body ?? '',
            imageUrl: message.mediaUrl,
            imageData: asset?.data,
            ...interactivePayload(message.providerPayload),
            ...(quoted?{quoted}:{})
          });
      await this.prisma.message.update({
        where: { id: message.id },
        data: { externalId: externalId ?? message.externalId, status: 'SENT', sentAt: new Date(), errorCode: null }
      });
      if (typingSeconds > 0) await socket.sendPresenceUpdate('paused', jid).catch(() => undefined);
    } catch (error) {
      await this.prisma.message.update({
        where: { id: message.id },
        data: { status: 'FAILED', errorCode: error instanceof Error ? error.message.slice(0, 200) : 'SEND_FAILED' }
      });
      throw error;
    }
    await continueSequence();
  }

  private async relayOutbox(outboundQueue: Queue<OutboundJob>, automationQueue: Queue<AutomationJob>) {
    if (this.relayingOutbox) return;
    this.relayingOutbox = true;
    try {
    const events = await this.prisma.outboxEvent.findMany({
      where: { type: { in: ['message.send.requested','notification.send.requested','reaction.send.requested', 'automation.execution.requested', 'automation.sequence.continue.requested', 'automation.inbound.received', 'automation.trigger.requested', 'knowledge.index.requested'] }, processedAt: null, availableAt: { lte: new Date() }, attempts: { lt: 10 } },
      take: 50,
      orderBy: { createdAt: 'asc' }
    });
    for (const event of events) {
      const payload = event.payload as { messageId?: string; executionId?: string; resumeStepId?:string; sequenceIndex?:number; conversationId?: string; contactId?:string; tagId?:string; event?:string; sourceId?:string; content?:string|null;channelId?:string;phone?:string;text?:string;messageExternalId?:string;emoji?:string };
      const valid = event.type === 'message.send.requested' ? Boolean(payload.messageId)
        : event.type==='notification.send.requested'?Boolean(payload.channelId&&payload.phone&&payload.text)
        : event.type==='reaction.send.requested'?Boolean(payload.channelId&&payload.phone&&payload.messageExternalId&&payload.emoji)
        : event.type === 'automation.sequence.continue.requested' ? Boolean(payload.executionId && payload.resumeStepId && Number.isInteger(payload.sequenceIndex) && payload.sequenceIndex! >= 1)
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
        } else if(event.type==='notification.send.requested'){
          await outboundQueue.add('notification',{notification:{channelId:payload.channelId!,phone:payload.phone!,text:payload.text!}},{...commonOptions,attempts:3});
        } else if(event.type==='reaction.send.requested'){
          await outboundQueue.add('reaction',{reaction:{channelId:payload.channelId!,phone:payload.phone!,messageExternalId:payload.messageExternalId!,emoji:payload.emoji!}},{...commonOptions,attempts:3});
        } else if(event.type==='automation.sequence.continue.requested'){
          await automationQueue.add('sequence_next', { executionId: payload.executionId!, action: 'sequence_next', resumeStepId: payload.resumeStepId!, sequenceIndex: payload.sequenceIndex! }, sequenceJobOptions(payload.resumeStepId!,payload.sequenceIndex!));
        } else if (event.type === 'automation.inbound.received' && await this.resumeWaitingExecution(automationQueue, payload.conversationId!, payload.messageId, commonOptions)) {
          // The message answered a pending wait; it must not also start a new execution.
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

  private async resumeWaitingExecution(automationQueue: Queue<AutomationJob>, conversationId: string, messageId: string | undefined, jobOptions: Record<string, unknown>) {
    if (!messageId) return false;
    const waiting = await this.prisma.execution.findFirst({ where: { conversationId, status: 'WAITING' }, orderBy: { startedAt: 'desc' }, select: { id: true, context: true, playbookVersion: { select: { definition: true } } } });
    const pending = waiting?.context && typeof waiting.context === 'object' && !Array.isArray(waiting.context) ? pendingWaitOf((waiting.context as { _runtime?: unknown })._runtime) : undefined;
    if (!waiting || !pending) return false;
    const job: AutomationJob = { executionId: waiting.id, action: 'menu_reply', resumeStepId: pending.stepId, messageId };
    if (pending.kind === 'menu') {
      await automationQueue.add('menu_reply', job, jobOptions);
      return true;
    }
    // A message older than the wait would consume the fixed jobId with nothing to read and swallow the real reply.
    const message = pending.since ? await this.prisma.message.findUnique({ where: { id: messageId }, select: { createdAt: true } }) : null;
    if (message && message.createdAt < new Date(pending.since!)) return true;
    const nodes = (waiting.playbookVersion.definition as { nodes?: Array<{ id: string; config?: Record<string, unknown> }> } | null)?.nodes ?? [];
    const buffer = waitBufferSeconds(nodes.find(node => node.id === pending.nodeId)?.config ?? {});
    // Fixed jobId: later messages inside the buffer are deduplicated, and the delayed job reads every reply since `since`.
    await automationQueue.add('menu_reply', job, { ...jobOptions, jobId: `automation-wait-reply-${waiting.id}-${pending.stepId}`, delay: buffer * 1000 });
    return true;
  }

  private async startTriggeredExecution(automationQueue: Queue<AutomationJob>, input: {triggerEvent:string;conversationId?:string;contactId?:string;messageId?:string;tagId?:string;jobOptions:Record<string,unknown>}) {
    const include = { contact: { include: { tags: { include: { tag: true } } } }, channel: { include: { activePlaybook: { include: { activeVersion: true } } } } } as const;
    const conversation = input.conversationId
      ? await this.prisma.conversation.findUnique({ where: { id: input.conversationId }, include })
      : await this.prisma.conversation.findFirst({ where: { contactId: input.contactId!, status: { not: 'RESOLVED' }, channel: { activePlaybookId: { not: null } } }, include, orderBy: { updatedAt: 'desc' } });
    const version = conversation?.channel.activePlaybook?.activeVersion;
    if (!conversation || !version || !acceptsNewEntrants(conversation.channel.activePlaybook!.status)) return;
    if (!matchesAutomationTrigger(version.definition, input.triggerEvent, input.tagId)) return;
    const active = await this.prisma.execution.findFirst({ where: { conversationId: conversation.id, playbookVersionId: version.id, status: { in: ['RUNNING', 'WAITING'] } } });
    if (active) return;
    const once = isOncePerContact(version.definition);
    const prior = once && !!await this.prisma.execution.findFirst({ where: { playbookVersion: { playbookId: version.playbookId }, conversation: { contactId: conversation.contactId } }, select: { id: true } });
    if (!shouldStartForContact(once, prior)) return;
    if (!await this.canStartExecution(conversation.workspaceId)) {
      await this.prisma.$transaction([
        this.prisma.conversation.update({where:{id:conversation.id},data:{mode:'HUMAN',status:'QUEUED'}}),
        this.prisma.auditLog.create({data:{workspaceId:conversation.workspaceId,action:'billing.execution_quota_handoff',targetType:'Conversation',targetId:conversation.id,changes:{reason:'executionsMonthly'}}})
      ]);
      return;
    }
    const lastMessage = input.messageId ? (await this.prisma.message.findUnique({ where: { id: input.messageId }, select: { body: true } }))?.body ?? '' : '';
    const execution = await this.prisma.execution.create({ data: {
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      playbookVersionId: version.id,
      context: {
        trigger: { event: input.triggerEvent, messageId: input.messageId ?? null, tagId: input.tagId ?? null },
        contact: { id: conversation.contact.id, name: conversation.contact.name, firstName: firstName(conversation.contact.name), phone: conversation.contact.phone, email: conversation.contact.email, stage: conversation.contact.stage, customFields: conversation.contact.customFields, tags: conversation.contact.tags.map(item => ({ id: item.tag.id, name: item.tag.name })), tagIds: conversation.contact.tags.map(item => item.tag.id) },
        conversation: { id: conversation.id, status: conversation.status, mode: conversation.mode },
        channel: { id: conversation.channel.id, phone: conversation.channel.phoneNumber },
        last_message: lastMessage
      }
    } });
    await automationQueue.add('start', { executionId: execution.id, action: 'start' }, input.jobOptions);
  }

  private async purgeExpiredMedia() {
    try {
      await this.prisma.messageMedia.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - MEDIA_RETENTION_MS) } } });
    } catch (error) {
      this.logger.warn({ err: error }, 'failed to purge expired message media');
    }
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
    if (this.mediaTimer) clearInterval(this.mediaTimer);
    await Promise.all(this.workers.map(worker => worker.close()));
    await Promise.all(this.queues.map(queue => queue.close()));
  }
}
