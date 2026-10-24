import type { Prisma } from '@prisma/client';
import type { DepartmentAssignment } from './department.js';

export type ChatControllerConfig = { state: 'AWAITING' | 'ATTENDING' | 'RESOLVED'; departmentId?: string; queue?: string; assigneeId?: string; reason?: string; returnToAi: boolean };
export type ChatControllerSlot = 'CONVERSATION_RESOLVED';

// Applies the state inside the caller's transaction. RESOLVED claims the transition with a conditional update, so concurrent
// or replayed runs see count 0 and emit nothing: CONVERSATION_RESOLVED fires exactly once per resolution.
export async function applyChatController(tx: Prisma.TransactionClient, input: { workspaceId: string; conversationId: string; config: ChatControllerConfig; assignment?: DepartmentAssignment }): Promise<ChatControllerSlot[]> {
  const { workspaceId, conversationId, config } = input;
  if (config.state === 'RESOLVED') {
    const claimed = await tx.conversation.updateMany({ where: { id: conversationId, workspaceId, status: { not: 'RESOLVED' } }, data: { status: 'RESOLVED', resolvedAt: new Date(), unreadCount: 0 } });
    if (claimed.count === 0) return [];
    await tx.outboxEvent.create({ data: { workspaceId, aggregate: 'Conversation', aggregateId: conversationId, type: 'automation.channel_slot.requested', payload: { conversationId, slot: 'CONVERSATION_RESOLVED' } } });
    return ['CONVERSATION_RESOLVED'];
  }
  // Legacy configs (no department/queue/assignee) must leave the conversation's existing queue and assignee alone;
  // only AWAITING clears the assignee. The caller resolved the department against the workspace already.
  const attending = config.state === 'ATTENDING';
  const assigneeId = attending ? input.assignment?.assigneeId : undefined;
  const queue = attending ? input.assignment?.queue ?? undefined : undefined;
  const departmentId = attending ? input.assignment?.departmentId ?? undefined : undefined;
  await tx.conversation.update({ where: { id: conversationId }, data: { mode: 'HUMAN', status: assigneeId ? 'ASSIGNED' : 'QUEUED', ...(config.state === 'AWAITING' ? { assigneeId: null } : assigneeId ? { assigneeId } : {}), ...(queue ? { queue } : {}), ...(departmentId ? { departmentId } : {}) } });
  return [];
}
