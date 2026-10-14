import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import pino from 'pino';
import { PrismaService } from './infra/prisma.service.js';
import { RedisService } from './infra/redis.service.js';
import { QUEUES, type AutomationJob, type ConnectionJob, type OutboundJob } from './queues.js';
import { WhatsAppSessionManager } from './whatsapp/session-manager.service.js';
import { outboundMessageId } from './whatsapp/message-id.js';
import { AutomationEngineService } from './automation/automation-engine.service.js';

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
    private readonly automation: AutomationEngineService
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
      const result = await socket.sendMessage(jid, { text: message.body ?? '' }, {
        messageId: outboundMessageId(message.clientRequestId ?? message.id)
      });
      await this.prisma.message.update({
        where: { id: message.id },
        data: { externalId: result?.key.id ?? message.externalId, status: 'SENT', sentAt: new Date(), errorCode: null }
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
      where: { type: { in: ['message.send.requested', 'automation.execution.requested', 'automation.inbound.received'] }, processedAt: null, availableAt: { lte: new Date() }, attempts: { lt: 10 } },
      take: 50,
      orderBy: { createdAt: 'asc' }
    });
    for (const event of events) {
      const payload = event.payload as { messageId?: string; executionId?: string; conversationId?: string };
      const valid = event.type === 'message.send.requested' ? Boolean(payload.messageId) : event.type === 'automation.inbound.received' ? Boolean(payload.conversationId) : Boolean(payload.executionId);
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
        if (event.type === 'automation.inbound.received') {
          const conversation = await this.prisma.conversation.findUnique({where:{id:payload.conversationId!},include:{channel:{include:{activePlaybook:{include:{activeVersion:true}}}}}});
          const version = conversation?.channel.activePlaybook?.activeVersion;
          if (conversation && version) {
            let execution = await this.prisma.execution.findFirst({where:{conversationId:conversation.id,playbookVersionId:version.id,status:{in:['RUNNING','WAITING']}}});
            execution ??= await this.prisma.execution.create({data:{workspaceId:conversation.workspaceId,conversationId:conversation.id,playbookVersionId:version.id,context:{trigger:{messageId:payload.messageId,event:'message.received'}}}});
            await automationQueue.add('start',{executionId:execution.id,action:'start'},commonOptions);
          }
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
