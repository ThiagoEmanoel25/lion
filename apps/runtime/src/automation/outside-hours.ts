import { isWithinBusinessHours, type BusinessHoursConfig } from '@nexo/domain';
import type { PrismaService } from '../infra/prisma.service.js';
import type { RedisService } from '../infra/redis.service.js';

export const OUTSIDE_HOURS_AUTHOR = 'outside_hours';
export const OUTSIDE_HOURS_WINDOW_MS = 12 * 3_600_000;
type Redis = Pick<RedisService, 'set' | 'del'>;

/** Lê a configuração gravada por PUT /v1/workspace/business-hours (settings.businessHours). Sem configuração salva ou sem mensagem: null. */
export function outsideHoursSettings(settings: unknown, timezone: string): { config: BusinessHoursConfig; timezone: string; message: string } | null {
  const value = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as { businessHours?: unknown }).businessHours : undefined;
  if (!value || typeof value !== 'object') return null;
  const hours = value as { days?: unknown; outsideMessage?: unknown; timezone?: unknown };
  const message = typeof hours.outsideMessage === 'string' ? hours.outsideMessage.trim() : '';
  if (!message || !Array.isArray(hours.days)) return null;
  return { config: { days: hours.days as BusinessHoursConfig['days'] }, timezone: typeof hours.timezone === 'string' && hours.timezone ? hours.timezone : timezone, message: message.slice(0, 500) };
}

/**
 * Chegou mensagem do cliente: se estiver fora do expediente, enfileira `outsideMessage` UMA vez por conversa a cada 12 h.
 * Não interrompe fluxos nem o atendimento humano (só acrescenta uma mensagem). Idempotente entre réplicas: claim atômico no Redis
 * (SET NX, TTL 12 h) mais checagem no banco da última mensagem automática de horário. Se o enfileiramento falha, o claim é
 * devolvido e o erro sobe para o outbox tentar de novo. Retorna o id da mensagem criada, ou null.
 */
export async function sendOutsideHoursNotice(prisma: PrismaService, redis: Redis, input: { workspaceId: string; conversationId: string; now?: Date }): Promise<string | null> {
  const now = input.now ?? new Date();
  const workspace = await prisma.workspace.findUnique({ where: { id: input.workspaceId }, select: { settings: true, timezone: true } });
  if (!workspace) return null;
  const settings = outsideHoursSettings(workspace.settings, workspace.timezone);
  if (!settings || isWithinBusinessHours(settings.config, now, settings.timezone)) return null;
  const conversation = await prisma.conversation.findFirst({ where: { id: input.conversationId, workspaceId: input.workspaceId }, select: { id: true } });
  if (!conversation) return null;
  const key = `outside-hours:${input.conversationId}`;
  if ((await redis.set(key, String(now.getTime()), 'PX', OUTSIDE_HOURS_WINDOW_MS, 'NX')) !== 'OK') return null;
  try {
    if (await prisma.message.findFirst({ where: { conversationId: input.conversationId, authorType: OUTSIDE_HOURS_AUTHOR, createdAt: { gt: new Date(now.getTime() - OUTSIDE_HOURS_WINDOW_MS) } }, select: { id: true } })) return null;
    return await prisma.$transaction(async tx => {
      const message = await tx.message.create({ data: { workspaceId: input.workspaceId, conversationId: input.conversationId, direction: 'OUTBOUND', type: 'TEXT', status: 'PENDING', body: settings.message, authorType: OUTSIDE_HOURS_AUTHOR } });
      await tx.outboxEvent.create({ data: { workspaceId: input.workspaceId, aggregate: 'Message', aggregateId: message.id, type: 'message.send.requested', payload: { messageId: message.id } } });
      return message.id;
    });
  } catch (error) {
    await redis.del(key).catch(() => undefined);
    throw error;
  }
}
