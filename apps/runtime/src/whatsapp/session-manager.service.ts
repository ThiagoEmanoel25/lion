import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Boom } from '@hapi/boom';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  jidNormalizedUser,
  type BaileysEventMap,
  type WASocket
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { loadConfig } from '../config.js';
import { PrismaService } from '../infra/prisma.service.js';
import { RedisService } from '../infra/redis.service.js';
import { QUEUES, type ConnectionJob } from '../queues.js';
import { acquireLock, type LockLease } from './distributed-lock.js';
import { AuthStateStore } from './auth-state.store.js';
import { messageBody, messageType } from './message-content.js';

type LiveSession = { socket: WASocket; lease: LockLease; renewTimer: NodeJS.Timeout; manualClose: boolean };

@Injectable()
export class WhatsAppSessionManager implements OnModuleDestroy {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly logger = pino({ level: loadConfig().logLevel }).child({ module: 'whatsapp' });
  private readonly connectionQueue: Queue<ConnectionJob>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly authStore: AuthStateStore
  ) {
    this.connectionQueue = new Queue(QUEUES.whatsappConnection, { connection: this.redis });
  }

  getSocket(channelId: string): WASocket | undefined { return this.sessions.get(channelId)?.socket; }

  async connect(channelId: string, pairingPhoneNumber?: string) {
    if (this.sessions.has(channelId)) return;
    const channel = await this.prisma.channel.findFirst({ where: { id: channelId, provider: 'baileys' } });
    if (!channel) throw new Error(`Baileys channel ${channelId} not found`);
    const lease = await acquireLock(this.redis, `wa:lock:${channelId}`);
    if (!lease) {
      this.logger.info({ channelId }, 'session is owned by another runtime');
      return;
    }

    try {
      const { state, saveCreds } = await this.authStore.load(channelId);
      const socket = makeWASocket({
        auth: state,
        browser: Browsers.ubuntu('Nexo'),
        logger: this.logger,
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        getMessage: async () => undefined
      });
      const renewTimer = setInterval(async () => {
        if (await lease.renew()) return;
        this.logger.error({ channelId }, 'lost session lease');
        socket.end(new Error('session lease lost'));
        await this.dropSession(channelId);
      }, 15_000);
      renewTimer.unref();
      this.sessions.set(channelId, { socket, lease, renewTimer, manualClose: false });

      socket.ev.on('creds.update', saveCreds);
      socket.ev.on('connection.update', update => { void this.onConnectionUpdate(channelId, update); });
      socket.ev.on('messages.upsert', event => { void this.onMessages(channelId, event); });
      socket.ev.on('messages.update', updates => { void this.onMessageUpdates(channelId, updates); });

      if (pairingPhoneNumber && !state.creds.registered) {
        const code = await socket.requestPairingCode(pairingPhoneNumber.replace(/\D/g, ''));
        await this.setState(channelId, { status: 'PAIRING', pairingCode: code });
      } else {
        await this.setState(channelId, { status: 'CONNECTING' });
      }
    } catch (error) {
      if (this.sessions.has(channelId)) await this.dropSession(channelId);
      else await lease.release();
      throw error;
    }
  }

  async disconnect(channelId: string, removeAuth = false) {
    const session = this.sessions.get(channelId);
    if (session) {
      session.manualClose = true;
      try {
        if (removeAuth) await session.socket.logout();
        else session.socket.end(new Error('manual disconnect'));
      } finally {
        await this.dropSession(channelId);
      }
    }
    if (removeAuth) await this.authStore.clear(channelId);
    await this.prisma.channel.updateMany({ where: { id: channelId }, data: { status: 'DISCONNECTED', externalPhoneId: null } });
    await this.setState(channelId, { status: 'DISCONNECTED' });
  }

  private async onConnectionUpdate(channelId: string, update: BaileysEventMap['connection.update']) {
    if (update.qr) await this.setState(channelId, { status: 'QR_REQUIRED', qr: update.qr });
    if (update.connection === 'open') {
      const socket = this.sessions.get(channelId)?.socket;
      const externalPhoneId = socket?.user?.id ? jidNormalizedUser(socket.user.id) : undefined;
      await this.prisma.channel.update({
        where: { id: channelId },
        data: { status: 'CONNECTED', ...(externalPhoneId ? { externalPhoneId } : {}) }
      });
      await this.setState(channelId, { status: 'CONNECTED', phoneJid: externalPhoneId });
      return;
    }
    if (update.connection !== 'close') return;

    const session = this.sessions.get(channelId);
    // Baileys already supplies a Boom here. Wrapping it in a new Boom would
    // commonly turn the original 401 into 500 and miss the logged-out branch.
    const statusCode = (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
    const loggedOut = statusCode === DisconnectReason.loggedOut;
    const manualClose = session?.manualClose ?? false;
    await this.dropSession(channelId);

    if (loggedOut) {
      await this.authStore.clear(channelId);
      await this.prisma.channel.update({ where: { id: channelId }, data: { status: 'DISCONNECTED', externalPhoneId: null } });
      await this.setState(channelId, { status: 'LOGGED_OUT' });
    } else if (!manualClose) {
      await this.prisma.channel.update({ where: { id: channelId }, data: { status: 'DEGRADED' } });
      await this.setState(channelId, { status: 'RECONNECTING' });
      await this.connectionQueue.add('reconnect', { channelId, action: 'reconnect' }, {
        jobId: `reconnect-${channelId}-${Date.now()}`,
        delay: 3_000,
        attempts: 8,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 100,
        removeOnFail: 500
      });
    }
  }

  private async onMessages(channelId: string, event: BaileysEventMap['messages.upsert']) {
    for (const incoming of event.messages) {
      const remoteJid = incoming.key.remoteJid;
      const externalId = incoming.key.id;
      if (!remoteJid || !externalId || incoming.key.fromMe || remoteJid === 'status@broadcast') continue;
      const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
      if (!channel) continue;
      const phone = `+${remoteJid.split('@')[0]!.split(':')[0]!.replace(/\D/g, '')}`;
      const body = messageBody(incoming.message);
      try {
        await this.prisma.$transaction(async tx => {
          await tx.rawWebhookEvent.create({
            data: {
              workspaceId: channel.workspaceId,
              channelId,
              provider: 'baileys',
              externalId: `${channelId}:${externalId}`,
              payload: { externalId, remoteJid, pushName: incoming.pushName ?? null },
              status: 'PROCESSED',
              processedAt: new Date()
            }
          });
          const contact = await tx.contact.upsert({
            where: { workspaceId_phone: { workspaceId: channel.workspaceId, phone } },
            create: { workspaceId: channel.workspaceId, phone, name: incoming.pushName, externalRef: remoteJid, source: 'whatsapp' },
            update: { externalRef: remoteJid, ...(incoming.pushName ? { name: incoming.pushName } : {}) }
          });
          let conversation = await tx.conversation.findFirst({
            where: { workspaceId: channel.workspaceId, channelId, contactId: contact.id, status: { not: 'RESOLVED' } },
            orderBy: { createdAt: 'desc' }
          });
          const conversationWasCreated = !conversation;
          conversation ??= await tx.conversation.create({
            data: { workspaceId: channel.workspaceId, channelId, contactId: contact.id, status: 'NEW', mode: 'AI' }
          });
          const created = await tx.message.create({
            data: {
              workspaceId: channel.workspaceId,
              conversationId: conversation.id,
              externalId,
              direction: 'INBOUND',
              type: messageType(incoming.message),
              status: 'DELIVERED',
              body,
              authorType: 'contact',
              authorId: contact.id,
              providerPayload: { remoteJid, participant: incoming.key.participant ?? null },
              deliveredAt: new Date()
            }
          });
          await tx.conversation.update({ where: { id: conversation.id }, data: { unreadCount: { increment: 1 }, updatedAt: new Date() } });
          await tx.channel.update({ where: { id: channelId }, data: { lastInboundAt: new Date() } });
          await tx.outboxEvent.create({data:{workspaceId:channel.workspaceId,aggregate:'Conversation',aggregateId:conversation.id,type:'automation.inbound.received',payload:{conversationId:conversation.id,messageId:created.id,channelId}}});
          if (conversationWasCreated) await tx.outboxEvent.create({data:{workspaceId:channel.workspaceId,aggregate:'Conversation',aggregateId:conversation.id,type:'automation.trigger.requested',payload:{event:'conversation.created',conversationId:conversation.id,contactId:contact.id,channelId}}});
          return created;
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
        this.logger.error({ channelId, externalId, err: error }, 'failed to persist inbound message');
      }
    }
  }

  private async onMessageUpdates(channelId: string, updates: BaileysEventMap['messages.update']) {
    for (const item of updates) {
      if (!item.key.id || item.update.status == null) continue;
      const status = Number(item.update.status);
      await this.prisma.message.updateMany({
        where: { externalId: item.key.id, conversation: { channelId } },
        data: status >= 4
          ? { status: 'READ', readAt: new Date(), deliveredAt: new Date() }
          : status >= 3 ? { status: 'DELIVERED', deliveredAt: new Date() } : { status: 'SENT' }
      });
    }
  }

  private async setState(channelId: string, state: Record<string, unknown>) {
    await this.redis.set(`wa:session:${channelId}`, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }), 'EX', 300);
  }

  private async dropSession(channelId: string) {
    const session = this.sessions.get(channelId);
    if (!session) return;
    clearInterval(session.renewTimer);
    this.sessions.delete(channelId);
    await session.lease.release();
  }

  async onModuleDestroy() {
    for (const [channelId, session] of this.sessions) {
      session.manualClose = true;
      session.socket.end(new Error('runtime shutdown'));
      await this.dropSession(channelId);
    }
    await this.connectionQueue.close();
  }
}
