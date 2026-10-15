import { describe, expect, it } from 'vitest';
import { liveConditionContext, mergeLiveContext, type LiveSnapshot } from './live-context.js';

const snapshot = (overrides: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
  timeZone: 'America/Bahia',
  now: new Date('2026-10-15T15:00:00Z'),
  contact: { id: 'c1', name: 'Ana', phone: '+5571999990000', email: null, stage: 'new', customFields: { plano: 'pro' }, tags: [{ id: 't1', name: 'vip' }] },
  conversation: { id: 'v1', status: 'QUEUED', mode: 'AI', assigneeId: null, queue: 'Atendimento' },
  lastInboundAt: new Date('2026-10-15T10:00:00Z'),
  ...overrides
});

describe('liveConditionContext', () => {
  it('expõe ids das etiquetas, janela de 24h e sistema no fuso', () => {
    const live = liveConditionContext(snapshot());
    expect(live.contact.tagIds).toEqual(['t1']);
    expect(live.conversation.window24h).toBe(true);
    expect(live.system).toEqual({ weekday: 4, time: '12:00', date: '2026-10-15' });
  });

  it('janela fechada sem mensagem recebida ou após 24h', () => {
    expect(liveConditionContext(snapshot({ lastInboundAt: null })).conversation.window24h).toBe(false);
    expect(liveConditionContext(snapshot({ lastInboundAt: new Date('2026-10-14T15:00:00Z') })).conversation.window24h).toBe(false);
  });
});

describe('mergeLiveContext', () => {
  it('atualiza contato/conversa sem apagar chaves gravadas pelo fluxo', () => {
    const context = { contact: { name: 'Antigo', score: 90 }, conversation: { status: 'NEW' }, menu: { choice: 'a' } };
    const merged = mergeLiveContext(context, liveConditionContext(snapshot()));
    expect(merged.contact).toMatchObject({ name: 'Ana', score: 90, tagIds: ['t1'] });
    expect(merged.conversation).toMatchObject({ status: 'QUEUED', window24h: true });
    expect(merged.menu).toEqual({ choice: 'a' });
  });
});
