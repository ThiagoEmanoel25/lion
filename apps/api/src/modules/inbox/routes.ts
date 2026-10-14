import type { FastifyPluginAsync } from 'fastify';
import { AssignConversationInput, ChangeConversationModeInput, SendMessageInput } from '@nexo/contracts';
import { DomainError } from '@nexo/domain';
import { enqueue } from '../../core/outbox.js';
import { audit } from '../../core/audit.js';

export const inboxRoutes: FastifyPluginAsync = async app => {
  app.get('/v1/conversations', { preHandler: [app.requirePermission('conversation.read')] }, async request => {
    const q = request.query as { status?: any; assigneeId?: string; cursor?: string };
    const items = await app.prisma.conversation.findMany({
      where: { workspaceId: request.auth.workspaceId, status: q.status, assigneeId: q.assigneeId },
      include: { contact: true, assignee: { select: { id: true, name: true } }, messages: { take: 1, orderBy: { createdAt: 'desc' } } },
      orderBy: { updatedAt: 'desc' }, take: 51,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {})
    });
    return { items: items.slice(0, 50), nextCursor: items.length > 50 ? items[49]!.id : null };
  });

  app.get('/v1/conversations/:id', { preHandler: [app.requirePermission('conversation.read')] }, async request => {
    const { id } = request.params as { id: string };
    const item = await app.prisma.conversation.findFirst({
      where: { id, workspaceId: request.auth.workspaceId },
      include: {
        contact: { include: { tags: { include: { tag: true } } } },
        assignee: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: 'asc' }, take: 200 },
        executions: { take: 1, orderBy: { startedAt: 'desc' }, include: { steps: { orderBy: { startedAt: 'asc' } } } }
      }
    });
    if (!item) throw new DomainError('NOT_FOUND', 'Conversa não encontrada.', 404);
    return item;
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
    const result = await app.prisma.conversation.updateMany({ where: { id, workspaceId: request.auth.workspaceId }, data: { assigneeId: input.assigneeId, queue: input.queue, status: input.assigneeId ? 'ASSIGNED' : 'QUEUED' } });
    if (!result.count) throw new DomainError('NOT_FOUND', 'Conversa não encontrada.', 404);
    return { ok: true };
  });

  app.post('/v1/conversations/:id/mode', { preHandler: [app.requirePermission('conversation.reply')] }, async request => {
    const { id } = request.params as { id: string };
    const input = ChangeConversationModeInput.parse(request.body);
    const updated = await app.prisma.conversation.updateMany({ where: { id, workspaceId: request.auth.workspaceId }, data: { mode: input.mode, assigneeId: input.mode === 'HUMAN' ? request.auth.userId : undefined, status: input.mode === 'HUMAN' ? 'ASSIGNED' : undefined } });
    if (!updated.count) throw new DomainError('NOT_FOUND', 'Conversa não encontrada.', 404);
    await audit(app.prisma, { workspaceId: request.auth.workspaceId, actorId: request.auth.userId, action: 'conversation.mode_changed', targetType: 'Conversation', targetId: id, changes: { mode: input.mode, reason: input.reason }, ip: request.ip });
    return { ok: true, mode: input.mode };
  });
};
