import type { Prisma } from '@prisma/client';

export type ChatControllerConfig = { state: 'AWAITING' | 'ATTENDING' | 'RESOLVED'; queue?: string; assigneeId?: string; reason?: string; returnToAi: boolean };
export type ChatControllerSlot = 'CONVERSATION_RESOLVED';

// Applies the state inside the caller's transaction. RESOLVED claims the transition with a conditional update, so concurrent
// or replayed runs see count 0 and emit nothing: CONVERSATION_RESOLVED fires exactly once per resolution.
export async function applyChatController(tx: Prisma.TransactionClient, input: { workspaceId: string; conversationId: string; config: ChatControllerConfig }): Promise<ChatControllerSlot[]> {
  const { workspaceId, conversationId, config } = input;
  const queue = config.queue?.trim() || undefined;
  if (config.state === 'RESOLVED') {
    const claimed = await tx.conversation.updateMany({ where: { id: conversationId, workspaceId, status: { not: 'RESOLVED' } }, data: { status: 'RESOLVED', resolvedAt: new Date(), unreadCount: 0 } });
    if (claimed.count === 0) return [];
    await tx.outboxEvent.create({ data: { workspaceId, aggregate: 'Conversation', aggregateId: conversationId, type: 'automation.channel_slot.requested', payload: { conversationId, slot: 'CONVERSATION_RESOLVED' } } });
    return ['CONVERSATION_RESOLVED'];
  }
  const assigneeId = config.state === 'ATTENDING' && config.assigneeId ? config.assigneeId : null;
  await tx.conversation.update({ where: { id: conversationId }, data: { mode: 'HUMAN', status: assigneeId ? 'ASSIGNED' : 'QUEUED', assigneeId, ...(config.state === 'ATTENDING' ? { queue: queue ?? null } : {}) } });
  return [];
}
