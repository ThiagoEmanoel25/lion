import { Inject,Injectable, OnModuleDestroy } from '@nestjs/common';
import { isOptOutMessage, normalizePhone } from '@nexo/domain';
import { Boom } from '@hapi/boom';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
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
import { MEDIA_MAX_BYTES, ctwaOf, mediaDownloadOptions, menuReply, messageBody, messageType, storableMedia, withCtwa } from './message-content.js';

const LEASE_GRACE_MS = 30_000;
const INBOUND_MAX_ATTEMPTS = 4;
const inboundBackoffMs = (attempt: number) => Math.min(5_000, 250 * 2 ** attempt);
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

type LiveSession = { socket: WASocket; lease: LockLease; renewTimer: NodeJS.Timeout; manualClose: boolean };

@Injectable()
export class WhatsAppSessionManager implements OnModuleDestroy {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly logger = pino({ level: loadConfig().logLevel, base: { service: 'nexo-runtime' }, timestamp: pino.stdTimeFunctions.isoTime, redact: { paths: ['*.password', '*.token', '*.apiKey', '*.accessToken', '*.creds', '*.keys'], censor: '[REDACTED]' } }).child({ module: 'whatsapp' });
  private readonly connectionQueue: Queue<ConnectionJob>;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(AuthStateStore) private readonly authStore: AuthStateStore
  ) {
    this.connectionQueue = new Queue(QUEUES.whatsappConnection, { connection: this.redis });
  }

  /** Handlers de evento do socket nunca podem gerar unhandledRejection. */
  private safely(channelId: string, event: string, run: () => Promise<void>) {
    void run().catch(error => this.logger.error({ channelId, event, err: error }, 'socket event handler failed'));
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
        browser: Browsers.ubuntu('Zuno Flow'),
        logger: this.logger,
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        getMessage: async () => undefined
      });
      let lastRenewedAt = Date.now();
      const renewTimer = setInterval(() => {
        void (async () => {
          try {
            if (await lease.renew()) {
              lastRenewedAt = Date.now();
              // The session snapshot is intentionally ephemeral so a crashed runtime
              // cannot look connected forever. Keep its TTL alive while this process
              // still owns the channel lease.
              await this.redis.expire(`wa:session:${channelId}`, 300);
              return;
            }
            this.logger.error({ channelId }, 'lost session lease');
          } catch (error) {
            // Redis indisponível: tolera falhas curtas, mas nunca segue enviando depois que o lock pode ter expirado
            // (TTL 45s), senão outra réplica assumiria a sessão e as duas enviariam em duplicidade.
            if (Date.now() - lastRenewedAt < LEASE_GRACE_MS) {
              this.logger.warn({ channelId, err: error }, 'failed to renew session lease; will retry');
              return;
            }
            this.logger.error({ channelId, err: error }, 'session lease could not be renewed in time; stopping this session');
          }
          socket.end(new Error('session lease lost'));
          await this.dropSession(channelId);
        })().catch(error => this.logger.error({ channelId, err: error }, 'session lease handler failed'));
      }, 15_000);
      renewTimer.unref();
      this.sessions.set(channelId, { socket, lease, renewTimer, manualClose: false });

      socket.ev.on('creds.update', saveCreds);
      socket.ev.on('connection.update', update => { this.safely(channelId, 'connection.update', () => this.onConnectionUpdate(channelId, update)); });
      socket.ev.on('messages.upsert', event => { this.safely(channelId, 'messages.upsert', () => this.onMessages(channelId, event)); });
      socket.ev.on('messages.update', updates => { this.safely(channelId, 'messages.update', () => this.onMessageUpdates(channelId, updates)); });

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

  /**
   * Só conversas individuais viram contato. Grupos (@g.us), newsletters, listas de transmissão e status
   * são ignorados. Um JID @lid só é aceito se o próprio evento trouxer o número real (senderPn).
   * Retorna o JID individual (@s.whatsapp.net) ou null.
   */
  private individualJid(channelId: string, key: { remoteJid?: string | null; senderPn?: string | null }): string | null {
    const jid = key.remoteJid ?? '';
    if (jid.endsWith('@s.whatsapp.net')) return jid;
    if (jid.endsWith('@lid')) {
      if (key.senderPn?.endsWith('@s.whatsapp.net')) return key.senderPn;
      this.logger.warn({ channelId, remoteJid: jid }, 'ignoring inbound from @lid JID without a phone number mapping (no contact created)');
      return null;
    }
    this.logger.debug({ channelId, remoteJid: jid }, 'ignoring inbound from non-individual chat (group, newsletter or broadcast)');
    return null;
  }

  private async onMessages(channelId: string, event: BaileysEventMap['messages.upsert']) {
    // Cada mensagem é isolada: o erro de uma (após retentativas) não descarta o restante do lote.
    for (const incoming of event.messages) {
      const externalId = incoming.key?.id;
      for (let attempt = 0; attempt < INBOUND_MAX_ATTEMPTS; attempt++) {
        try {
          await this.processInbound(channelId, incoming);
          break;
        } catch (error) {
          const last = attempt === INBOUND_MAX_ATTEMPTS - 1;
          this.logger[last ? 'error' : 'warn']({ channelId, externalId, remoteJid: incoming.key?.remoteJid, attempt: attempt + 1, err: error }, last ? 'failed to persist inbound message; giving up (message not stored)' : 'failed to persist inbound message; retrying');
          if (!last) await sleep(inboundBackoffMs(attempt));
        }
      }
    }
  }

  private async processInbound(channelId: string, incoming: BaileysEventMap['messages.upsert']['messages'][number]) {
    {
      const externalId = incoming.key.id;
      if (!externalId || incoming.key.fromMe) return;
      const remoteJid = this.individualJid(channelId, incoming.key as { remoteJid?: string | null; senderPn?: string | null });
      if (!remoteJid) return;
      const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
      if (!channel) return;
      // Replays on reconnect: skip before downloading media for a message we already stored.
      if (await this.prisma.rawWebhookEvent.findUnique({ where: { provider_externalId: { provider: 'baileys', externalId: `${channelId}:${externalId}` } }, select: { id: true } })) return;
      const phone = normalizePhone(`+${remoteJid.split('@')[0]!.split(':')[0]!}`);
      if (!phone) { this.logger.warn({ channelId, remoteJid }, 'ignoring inbound with an invalid phone number'); return; }
      const legacyPhone = phone.slice(1);
      const body = messageBody(incoming.message);
      const reply = menuReply(incoming.message);
      const media = storableMedia(incoming.message);
      let mediaData: Buffer | null = null;
      if (media?.download) {
        try {
          const downloaded = await downloadMediaMessage(incoming, 'buffer', mediaDownloadOptions());
          mediaData = downloaded.length <= MEDIA_MAX_BYTES ? downloaded : null;
        } catch (error) {
          this.logger.warn({ channelId, externalId, err: error }, 'failed to download inbound media');
        }
      }
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
          // Contatos antigos/da API podem estar gravados sem '+': reaproveita o mesmo contato em vez de duplicar.
          const existing = await tx.contact.findFirst({ where: { workspaceId: channel.workspaceId, phone: { in: [phone, legacyPhone] } }, orderBy: { createdAt: 'asc' }, select: { id: true } });
          const contact = existing
            ? await tx.contact.update({ where: { id: existing.id }, data: { externalRef: remoteJid, ...(incoming.pushName ? { name: incoming.pushName } : {}) } })
            : await tx.contact.create({ data: { workspaceId: channel.workspaceId, phone, name: incoming.pushName, externalRef: remoteJid, source: 'whatsapp' } });
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
              providerPayload: { remoteJid, participant: incoming.key.participant ?? null, ...(reply ? { menuReply: reply } : {}) },
              deliveredAt: new Date()
            }
          });
          if (media) await tx.messageMedia.create({ data: { workspaceId: channel.workspaceId, messageId: created.id, contentType: media.contentType, fileName: media.fileName, size: media.size, data: mediaData as Uint8Array<ArrayBuffer> | null } });
          const metadata = withCtwa(conversation.metadata, ctwaOf(incoming.message), new Date());
          await tx.conversation.update({ where: { id: conversation.id }, data: { unreadCount: { increment: 1 }, updatedAt: new Date(), ...(metadata ? { metadata: metadata as Prisma.InputJsonObject } : {}) } });
          await tx.channel.update({ where: { id: channelId }, data: { lastInboundAt: new Date() } });
          // "SAIR", "PARAR" e companhia tiram o contato dos disparos na hora. Pedir para sair e
          // continuar recebendo é o caminho mais curto para o número ser denunciado e bloqueado.
          if (isOptOutMessage(body)) await tx.contact.updateMany({ where: { id: contact.id, optedOutAt: null }, data: { optedOutAt: new Date() } });
          await tx.outboxEvent.create({data:{workspaceId:channel.workspaceId,aggregate:'Conversation',aggregateId:conversation.id,type:'automation.inbound.received',payload:{conversationId:conversation.id,messageId:created.id,channelId}}});
          if (conversationWasCreated) await tx.outboxEvent.create({data:{workspaceId:channel.workspaceId,aggregate:'Conversation',aggregateId:conversation.id,type:'automation.trigger.requested',payload:{event:'conversation.created',conversationId:conversation.id,contactId:contact.id,channelId}}});
          return created;
        });
      } catch (error) {
        // P2002 no rawWebhookEvent = reentrega já gravada (idempotente). Qualquer outro erro sobe para a retentativa.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
          && await this.prisma.rawWebhookEvent.findUnique({ where: { provider_externalId: { provider: 'baileys', externalId: `${channelId}:${externalId}` } }, select: { id: true } })) return;
        throw error;
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
