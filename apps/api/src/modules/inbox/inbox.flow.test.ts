import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('fluxo: inbox', () => {
  let t: TwoTenants; let fx: Fixtures;
  beforeAll(async () => { t = await setupTwoTenants(); fx = await t.fixtures(t.A); }, 60_000);
  afterAll(async () => { await t?.teardown(); });

  it('H2-11: conversa manual cria contato no mesmo formato do runtime (+E164) para a resposta do cliente cair no mesmo contato', async () => {
    const r = await t.as(t.A, 'POST', '/v1/conversations', { channelId: fx.channel.id, phone: '+55 (11) 98888-7777', name: 'Novo' });
    expect(r.status).toBe(201);
    const contact = await t.prisma.contact.findUnique({ where: { id: r.body.contactId } });
    // runtime/session-manager.service.ts grava `+${digits}` e faz upsert por (workspaceId, phone)
    expect(contact!.phone).toBe('+5511988887777');
  });

  it('H2-12: atribuir conversa a um agente deve colocá-la em modo HUMAN para ele conseguir responder', async () => {
    const conv = await t.prisma.conversation.create({ data: { workspaceId: t.A.workspaceId, channelId: fx.channel.id, contactId: fx.contact.id, status: 'NEW', mode: 'AI' } });
    expect((await t.as(t.A, 'POST', `/v1/conversations/${conv.id}/assign`, { assigneeId: t.A.userId })).status).toBe(200);
    const send = await t.as(t.A, 'POST', `/v1/conversations/${conv.id}/messages`, { body: 'oi', clientRequestId: randomUUID() });
    expect(send.status).toBe(202);
  });

  it('H2-13: duas requisições com o mesmo clientRequestId em paralelo não podem dar 500', async () => {
    const id = randomUUID();
    const rs = await Promise.all([1, 2, 3].map(() => t.as(t.A, 'POST', `/v1/conversations/${fx.conversation.id}/messages`, { body: 'dup', clientRequestId: id })));
    expect(rs.map(r => r.status)).toEqual([202, 202, 202]);
    expect(await t.prisma.message.count({ where: { workspaceId: t.A.workspaceId, clientRequestId: id } })).toBe(1);
    expect(await t.prisma.outboxEvent.count({ where: { workspaceId: t.A.workspaceId, aggregate: 'Message', aggregateId: rs[0]!.body.id } })).toBe(1);
  });

  it('caminho feliz: enviar, idempotência sequencial, listar, ler, transição, modo, status, buscas e paginação', async () => {
    const id = randomUUID();
    const a = await t.as(t.A, 'POST', `/v1/conversations/${fx.conversation.id}/messages`, { body: 'Olá 😀 ñ', clientRequestId: id });
    const b = await t.as(t.A, 'POST', `/v1/conversations/${fx.conversation.id}/messages`, { body: 'Olá 😀 ñ', clientRequestId: id });
    expect(a.status).toBe(202); expect(b.body.id).toBe(a.body.id);
    expect((await t.as(t.A, 'POST', `/v1/conversations/${fx.conversation.id}/messages`, { body: '  ', clientRequestId: randomUUID() })).status).toBe(422);
    expect((await t.as(t.A, 'POST', `/v1/conversations/${fx.conversation.id}/messages`, { body: 'x'.repeat(4097), clientRequestId: randomUUID() })).status).toBeLessThan(500);
    expect((await t.as(t.A, 'POST', `/v1/conversations/${fx.conversation.id}/read`)).status).toBe(200);
    expect((await t.as(t.A, 'GET', `/v1/conversations/${fx.conversation.id}`)).body.unreadCount).toBe(0);
    for (const q of ['?bucket=attending', '?status=ASSIGNED', '?attention=unread', '?attention=unanswered', '?mode=HUMAN', `?assigneeId=${t.A.userId}`, `?channelId=${fx.channel.id}`, `?search=${encodeURIComponent('Contato')}`, '?limit=1', '?limit=0', '?limit=500', '?cursor=abc', '?status=XYZ']) {
      const r = await t.as(t.A, 'GET', `/v1/conversations${q}`);
      expect(r.status, q).toBeLessThan(500);
    }
    const tr = await t.as(t.A, 'POST', `/v1/conversations/${fx.conversation.id}/transition`, { direction: 'forward' });
    expect(tr.body.status).toBe('RESOLVED');
    expect((await t.as(t.A, 'POST', `/v1/conversations/${fx.conversation.id}/transition`, { direction: 'forward' })).status).toBe(409);
    expect((await t.as(t.A, 'POST', `/v1/conversations/${fx.conversation.id}/mode`, { mode: 'AI' })).status).toBe(422);
    expect((await t.as(t.A, 'POST', `/v1/conversations/${fx.conversation.id}/mode`, { mode: 'AI', reason: 'x' })).status).toBe(200);
  });

  it('agendamento: limites de horário, cancelar duas vezes, conversa em modo AI', async () => {
    const mk = (when: Date) => t.as(t.A, 'POST', `/v1/conversations/${fx.conversation.id}/scheduled-messages`, { body: 'depois', scheduledFor: when.toISOString() });
    await t.as(t.A, 'POST', `/v1/conversations/${fx.conversation.id}/mode`, { mode: 'HUMAN', reason: 'x' });
    await t.as(t.A, 'POST', `/v1/conversations/${fx.conversation.id}/status`, { status: 'ASSIGNED', reason: 'x' });
    expect((await mk(new Date(Date.now() + 1000))).status).toBe(422);
    const ok = await mk(new Date(Date.now() + 3600_000));
    expect(ok.status).toBe(201);
    expect((await t.as(t.A, 'DELETE', `/v1/scheduled-messages/${ok.body.id}`)).status).toBe(204);
    expect((await t.as(t.A, 'DELETE', `/v1/scheduled-messages/${ok.body.id}`)).status).toBe(409);
  });

  it('H2-14: POST /conversations com telefone curto/longo/letras responde 4xx e não cria contato lixo', async () => {
    const n = await t.prisma.contact.count({ where: { workspaceId: t.A.workspaceId } });
    for (const phone of ['123', 'abcdefghijkl', '1'.repeat(16)]) expect((await t.as(t.A, 'POST', '/v1/conversations', { channelId: fx.channel.id, phone })).status).toBe(422);
    expect(await t.prisma.contact.count({ where: { workspaceId: t.A.workspaceId } })).toBe(n);
  });

  it('telefone canônico: contato legado sem "+" é reaproveitado e curado para +E.164 (sem duplicata)', async () => {
    const legacy = await t.prisma.contact.create({ data: { workspaceId: t.A.workspaceId, phone: '5511940000002', name: 'Legado' } });
    const r = await t.as(t.A, 'POST', '/v1/conversations', { channelId: fx.channel.id, phone: '(11) 94000-0002' });
    expect(r.status).toBe(201); expect(r.body.contactId).toBe(legacy.id);
    expect((await t.prisma.contact.findUnique({ where: { id: legacy.id } }))!.phone).toBe('+5511940000002');
    expect(await t.prisma.contact.count({ where: { workspaceId: t.A.workspaceId, phone: { in: ['5511940000002', '+5511940000002'] } } })).toBe(1);
  });

  it('H2-12: atribuir audita (conversation.assigned) com o modo anterior e o novo', async () => {
    const conv = await t.prisma.conversation.create({ data: { workspaceId: t.A.workspaceId, channelId: fx.channel.id, contactId: fx.contact.id, status: 'NEW', mode: 'AI' } });
    await t.as(t.A, 'POST', `/v1/conversations/${conv.id}/assign`, { assigneeId: t.A.userId });
    const row = await t.prisma.conversation.findUnique({ where: { id: conv.id } });
    expect(row).toMatchObject({ mode: 'HUMAN', status: 'ASSIGNED', assigneeId: t.A.userId });
    const log = await t.prisma.auditLog.findFirst({ where: { workspaceId: t.A.workspaceId, action: 'conversation.assigned', targetId: conv.id } });
    expect((log!.changes as any).mode).toEqual({ from: 'AI', to: 'HUMAN' });
  });

  it('H2-43: POST /conversations respeita a cota de contatos só para contato novo', async () => {
    const fb = await t.fixtures(t.B);
    await t.prisma.subscription.create({ data: { workspaceId: t.B.workspaceId, provider: 'test', plan: 'free', status: 'active', limits: { contacts: 1 }, currentPeriodStart: new Date(Date.now() - 864e5), currentPeriodEnd: new Date(Date.now() + 864e5) } as any });
    const blocked = await t.as(t.B, 'POST', '/v1/conversations', { channelId: fb.channel.id, phone: '+5511940000077' });
    expect(blocked.status).toBe(402); expect(blocked.body.code).toBe('QUOTA_EXCEEDED');
    const known = await t.as(t.B, 'POST', '/v1/conversations', { channelId: fb.channel.id, phone: fb.contact.phone });
    expect(known.status).toBeLessThan(300);
    await t.prisma.subscription.deleteMany({ where: { workspaceId: t.B.workspaceId } });
  });
});
