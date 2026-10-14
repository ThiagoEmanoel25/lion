import type { FastifyPluginAsync } from 'fastify';
import { AssignConversationInput, ChangeConversationModeInput, ChangeConversationStatusInput, SendMessageInput } from '@nexo/contracts';
import { DomainError } from '@nexo/domain';
import { enqueue } from '../../core/outbox.js';
import { audit } from '../../core/audit.js';
import { z } from 'zod';
import { modeTransition, statusTransition } from './state.js';

const ListConversationsQuery = z.object({
  status: z.enum(['NEW','AUTOMATED','WAITING_CUSTOMER','QUEUED','ASSIGNED','RESOLVED']).optional(),
  mode: z.enum(['AI','HUMAN','PAUSED']).optional(),
  assigneeId: z.string().cuid().optional(),
  search: z.string().trim().max(120).optional(),
  cursor: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30)
});

export const inboxRoutes: FastifyPluginAsync = async app => {
  app.get('/v1/conversations', { preHandler: [app.requirePermission('conversation.read')] }, async request => {
    const q = ListConversationsQuery.parse(request.query);
    const items = await app.prisma.conversation.findMany({
      where: {
        workspaceId: request.auth.workspaceId,
        status: q.status,
        mode: q.mode,
        assigneeId: q.assigneeId,
        ...(q.search ? { contact: { is: { OR: [
          { name: { contains: q.search, mode: 'insensitive' } },
          { phone: { contains: q.search } },
          { email: { contains: q.search, mode: 'insensitive' } }
        ] } } } : {})
      },
      include: { contact: true, assignee: { select: { id: true, name: true } }, messages: { take: 1, orderBy: { createdAt: 'desc' } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {})
    });
    return { items: items.slice(0, q.limit), nextCursor: items.length > q.limit ? items[q.limit - 1]!.id : null };
  });

  app.get('/v1/conversations/:id', { preHandler: [app.requirePermission('conversation.read')] }, async request => {
    const { id } = request.params as { id: string };
    const item = await app.prisma.conversation.findFirst({
      where: { id, workspaceId: request.auth.workspaceId },
      include: {
        contact: { include: { tags: { include: { tag: true } } } },
        assignee: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 200 },
        executions: { take: 3, orderBy: { startedAt: 'desc' }, include: {
          playbookVersion: { select: { version: true, playbook: { select: { id: true, name: true } } } },
          steps: { orderBy: { startedAt: 'asc' } }
        } }
      }
    });
    if (!item) throw new DomainError('NOT_FOUND', 'Conversa não encontrada.', 404);
    return { ...item, messages: [...item.messages].reverse() };
  });

  app.post('/v1/conversations/:id/messages', { preHandler: [app.requirePermission('conversation.reply')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = SendMessageInput.parse(request.body);
    const conversation = await app.prisma.conversation.findFirst({ where: { id, workspaceId: request.auth.workspaceId } });
    if (!conversation) throw new DomainError('NOT_FOUND', 'Conversa não encontrada.', 404);
    if (conversation.mode !== 'HUMAN') throw new DomainError('AI_HAS_CONTROL', 'Assuma a conversa antes de responder.', 409);
    const message = await app.prisma.$transaction(async tx => {
      const existing = await tx.message.findFirst({ where: { workspaceId: request.auth.workspaceId, clientRequestId: input.clientRequestId } });
      if (existing) return existing;
      const created = await tx.message.create({ data: { workspaceId: request.auth.workspaceId, conversationId: id, clientRequestId: input.clientRequestId, direction: 'OUTBOUND', body: input.body, authorType: 'user', authorId: request.auth.userId, status: 'QUEUED' } });
      await enqueue(tx, { workspaceId: request.auth.workspaceId, aggregate: 'Message', aggregateId: created.id, type: 'message.send.requested', payload: { messageId: created.id } });
      return created;
    });
    return reply.status(202).send(message);
  });

  app.post('/v1/conversations/:id/assign', { preHandler: [app.requirePermission('conversation.assign.self')] }, async request => {
    const { id } = request.params as { id: string };
    const input = AssignConversationInput.parse(request.body);
    if (request.auth.role === 'AGENT' && input.assigneeId !== null && input.assigneeId !== request.auth.userId) throw new DomainError('FORBIDDEN', 'Agentes só podem atribuir conversas a si mesmos.', 403);
    const result = await app.prisma.conversation.updateMany({ where: { id, workspaceId: request.auth.workspaceId }, data: { assigneeId: input.assigneeId, queue: input.queue, status: input.assigneeId ? 'ASSIGNED' : 'QUEUED' } });
    if (!result.count) throw new DomainError('NOT_FOUND', 'Conversa não encontrada.', 404);
    return { ok: true };
  });

  app.post('/v1/conversations/:id/mode', { preHandler: [app.requirePermission('conversation.reply')] }, async request => {
    const { id } = request.params as { id: string };
    const input = ChangeConversationModeInput.parse(request.body);
    const updated = await app.prisma.conversation.updateMany({ where: { id, workspaceId: request.auth.workspaceId }, data: modeTransition(input.mode, request.auth.userId) });
    if (!updated.count) throw new DomainError('NOT_FOUND', 'Conversa não encontrada.', 404);
    await audit(app.prisma, { workspaceId: request.auth.workspaceId, actorId: request.auth.userId, action: 'conversation.mode_changed', targetType: 'Conversation', targetId: id, changes: { mode: input.mode, reason: input.reason }, ip: request.ip });
    return { ok: true, mode: input.mode };
  });

  app.post('/v1/conversations/:id/read', { preHandler: [app.requirePermission('conversation.read')] }, async request => {
    const { id } = request.params as { id: string };
    const result = await app.prisma.conversation.updateMany({ where: { id, workspaceId: request.auth.workspaceId }, data: { unreadCount: 0 } });
    if (!result.count) throw new DomainError('NOT_FOUND', 'Conversa não encontrada.', 404);
    return { ok: true };
  });

  app.post('/v1/conversations/:id/status', { preHandler: [app.requirePermission('conversation.reply')] }, async request => {
    const { id } = request.params as { id: string };
    const input = ChangeConversationStatusInput.parse(request.body);
    const result = await app.prisma.conversation.updateMany({ where: { id, workspaceId: request.auth.workspaceId }, data: statusTransition(input.status) });
    if (!result.count) throw new DomainError('NOT_FOUND', 'Conversa não encontrada.', 404);
    await audit(app.prisma, { workspaceId: request.auth.workspaceId, actorId: request.auth.userId, action: 'conversation.status_changed', targetType: 'Conversation', targetId: id, changes: input, ip: request.ip });
    return { ok: true, status: input.status };
  });
};
