import { describe, expect, it } from 'vitest';
import { AutomationHandoffConfigSchema } from '@nexo/contracts';
import { applyChatController, type ChatControllerConfig } from './chat-controller.js';

type Conv = { status: string; mode: string; assigneeId: string | null; queue: string | null; unreadCount: number; resolvedAt?: Date };
function fakeTx(initial: Partial<Conv> = {}) {
  const conv: Conv = { status: 'AUTOMATED', mode: 'AI', assigneeId: 'u0', queue: 'Old', unreadCount: 3, ...initial };
  const outbox: Array<{ type: string; payload: { slot: string } }> = [];
  const tx = {
    conversation: {
      findFirst: async () => ({ mode: conv.mode }),
      update: async ({ data }: { data: Partial<Conv> }) => { Object.assign(conv, data); },
      updateMany: async ({ where, data }: { where: { status: { not: string } }; data: Partial<Conv> }) => { if (conv.status === where.status.not) return { count: 0 }; Object.assign(conv, data); return { count: 1 }; }
    },
    outboxEvent: { create: async ({ data }: { data: { type: string; payload: { slot: string } } }) => { outbox.push(data); } }
  };
  return { conv, outbox, run: (config: Partial<ChatControllerConfig> & { state: ChatControllerConfig['state'] }) => applyChatController(tx as never, { workspaceId: 'w', conversationId: 'c', config: { returnToAi: false, ...config } }) };
}

describe('chat controller', () => {
  it('AWAITING queues for humans and clears the assignee', async () => {
    const t = fakeTx(); expect(await t.run({ state: 'AWAITING' })).toEqual([]);
    expect(t.conv).toMatchObject({ mode: 'HUMAN', status: 'QUEUED', assigneeId: null, queue: 'Old' });
  });
  it('ATTENDING assigns when there is an assignee, queues otherwise', async () => {
    const a = fakeTx(); await a.run({ state: 'ATTENDING', queue: 'Vendas', assigneeId: 'u1' });
    expect(a.conv).toMatchObject({ mode: 'HUMAN', status: 'ASSIGNED', assigneeId: 'u1', queue: 'Vendas' });
    const q = fakeTx(); await q.run({ state: 'ATTENDING', queue: 'Vendas' });
    expect(q.conv).toMatchObject({ status: 'QUEUED', assigneeId: 'u0', queue: 'Vendas' });
  });
  it('legacy ATTENDING with no queue or assignee keeps the existing ones', async () => {
    const t = fakeTx({ status: 'ASSIGNED', queue: 'Vendas', assigneeId: 'u9' }); await t.run(AutomationHandoffConfigSchema.parse({ reason: 'x' }) as ChatControllerConfig);
    expect(t.conv).toMatchObject({ mode: 'HUMAN', status: 'QUEUED', queue: 'Vendas', assigneeId: 'u9' });
  });
  it('RESOLVED resolves, zeroes unread and emits CONVERSATION_RESOLVED once', async () => {
    const t = fakeTx(); expect(await t.run({ state: 'RESOLVED' })).toEqual(['CONVERSATION_RESOLVED']);
    expect(t.conv).toMatchObject({ status: 'RESOLVED', unreadCount: 0 }); expect(t.conv.resolvedAt).toBeInstanceOf(Date);
    expect(t.outbox.map(e => e.payload.slot)).toEqual(['CONVERSATION_RESOLVED']);
  });
  it('re-running RESOLVED (replay) does not emit again', async () => {
    const t = fakeTx(); await t.run({ state: 'RESOLVED' }); expect(await t.run({ state: 'RESOLVED' })).toEqual([]);
    expect(t.outbox).toHaveLength(1);
  });
  it('an already resolved conversation emits nothing', async () => {
    const t = fakeTx({ status: 'RESOLVED' }); expect(await t.run({ state: 'RESOLVED' })).toEqual([]); expect(t.outbox).toHaveLength(0);
  });
  it('resolving a HUMAN conversation emits only CONVERSATION_RESOLVED, once', async () => {
    const t = fakeTx({ mode: 'HUMAN', status: 'ASSIGNED' }); expect(await t.run({ state: 'RESOLVED' })).toEqual(['CONVERSATION_RESOLVED']);
    await t.run({ state: 'RESOLVED' }); expect(t.outbox.map(e => e.payload.slot)).toEqual(['CONVERSATION_RESOLVED']);
  });
});

describe('handoff config', () => {
  it('normalizes legacy {queue, reason} and empty configs to ATTENDING', () => {
    expect(AutomationHandoffConfigSchema.parse({ queue: 'Suporte', reason: 'x' })).toEqual({ state: 'ATTENDING', queue: 'Suporte', reason: 'x', returnToAi: false });
    expect(AutomationHandoffConfigSchema.parse({})).toMatchObject({ state: 'ATTENDING' });
    expect(AutomationHandoffConfigSchema.parse({ team: 'Time' })).toMatchObject({ queue: 'Time' });
  });
  it('accepts returnToAi only in AWAITING', () => {
    expect(AutomationHandoffConfigSchema.safeParse({ state: 'AWAITING', returnToAi: true }).success).toBe(true);
    expect(AutomationHandoffConfigSchema.safeParse({ state: 'RESOLVED', returnToAi: true }).success).toBe(false);
    expect(AutomationHandoffConfigSchema.safeParse({ queue: 'x', returnToAi: true }).success).toBe(false);
  });
});
