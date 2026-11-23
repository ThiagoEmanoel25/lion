import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('isolamento entre workspaces: inbox', () => {
  let t: TwoTenants; let a: Fixtures; let b: Fixtures;
  const conv = async () => JSON.stringify(await t.prisma.conversation.findUnique({ where: { id: a.conversation.id } }));
  const future = () => new Date(Date.now() + 2 * 3600_000).toISOString();
  beforeAll(async () => { t = await setupTwoTenants(); a = await t.fixtures(t.A); b = await t.fixtures(t.B); }, 60_000);
  afterAll(async () => { await t?.teardown(); });

  it('GET /v1/conversations: B não vê conversas de A (filtros, busca e contagens)', async () => {
    for (const qs of ['', `?channelId=${a.channel.id}`, `?assigneeId=${t.A.userId}`, `?search=${encodeURIComponent(a.contact.name!)}`, '?bucket=attending']) {
      const r = await t.as(t.B, 'GET', `/v1/conversations${qs}`);
      expect(r.status).toBe(200);
      expect(r.body.items.map((c: any) => c.id)).not.toContain(a.conversation.id);
    }
    const all = await t.as(t.B, 'GET', '/v1/conversations');
    expect(all.body.items.map((c: any) => c.id)).toEqual([b.conversation.id]);
    expect(all.body.counts).toEqual({ waiting: 0, attending: 1, resolved: 0 });
  });
  it('GET /v1/conversations/:id: 404', async () => {
    expect((await t.as(t.B, 'GET', `/v1/conversations/${a.conversation.id}`)).status).toBe(404);
  });
  it('POST /:id/messages: 404 e nenhuma mensagem criada em A', async () => {
    const n = await t.prisma.message.count({ where: { conversationId: a.conversation.id } });
    expect((await t.as(t.B, 'POST', `/v1/conversations/${a.conversation.id}/messages`, { body: 'oi', clientRequestId: randomUUID() })).status).toBe(404);
    expect(await t.prisma.message.count({ where: { conversationId: a.conversation.id } })).toBe(n);
  });
  it('POST /:id/messages em conversa de B com assetId de A: 422', async () => {
    const asset = await t.prisma.playbookAsset.create({ data: { workspaceId: t.A.workspaceId, fileName: 'a.png', contentType: 'image/png', size: 1, data: Buffer.from('x') } });
    const r = await t.as(t.B, 'POST', `/v1/conversations/${b.conversation.id}/messages`, { body: 'oi', clientRequestId: randomUUID(), assetId: asset.id });
    expect(r.status).toBe(422);
    expect(await t.prisma.message.count({ where: { conversationId: b.conversation.id, mediaUrl: { not: null } } })).toBe(0);
  });
  it('GET /:id/scheduled-messages: lista vazia, sem agendadas de A', async () => {
    const r = await t.as(t.B, 'GET', `/v1/conversations/${a.conversation.id}/scheduled-messages`);
    expect(r.status).toBe(200); expect(r.body).toEqual([]);
  });
  it('POST /:id/scheduled-messages: 404 e nada agendado em A', async () => {
    const n = await t.prisma.scheduledMessage.count({ where: { conversationId: a.conversation.id } });
    expect((await t.as(t.B, 'POST', `/v1/conversations/${a.conversation.id}/scheduled-messages`, { body: 'x', scheduledFor: future() })).status).toBe(404);
    expect(await t.prisma.scheduledMessage.count({ where: { conversationId: a.conversation.id } })).toBe(n);
  });
  it('DELETE /v1/scheduled-messages/:id: não cancela e responde igual a id inexistente', async () => {
    const r = await t.as(t.B, 'DELETE', `/v1/scheduled-messages/${a.scheduled.id}`);
    const ghost = await t.as(t.B, 'DELETE', '/v1/scheduled-messages/clzzzzzzzzzzzzzzzzzzzzzzz');
    expect([404, 409]).toContain(r.status);
    expect(r.status).toBe(ghost.status);
    expect((await t.prisma.scheduledMessage.findUnique({ where: { id: a.scheduled.id } }))!.status).toBe('PENDING');
  });
  it.each([
    ['transition', { direction: 'forward' }],
    ['mode', { mode: 'PAUSED', reason: 'x' }],
    ['status', { status: 'RESOLVED', reason: 'x' }],
    ['assign', { assigneeId: null }],
    ['read', {}],
  ])('POST /:id/%s: 404 e conversa de A intacta', async (action, body) => {
    const before = await conv();
    expect((await t.as(t.B, 'POST', `/v1/conversations/${a.conversation.id}/${action}`, body)).status).toBe(404);
    expect(await conv()).toBe(before);
  });
  it('POST /v1/conversations com channelId de A: 422 e nada criado', async () => {
    const n = await t.prisma.conversation.count({ where: { channelId: a.channel.id } });
    expect((await t.as(t.B, 'POST', '/v1/conversations', { channelId: a.channel.id, phone: '5511977776666' })).status).toBe(422);
    expect(await t.prisma.conversation.count({ where: { channelId: a.channel.id } })).toBe(n);
    expect(await t.prisma.contact.count({ where: { workspaceId: t.B.workspaceId, phone: '5511977776666' } })).toBe(0);
  });
  it('POST /:id/assign em conversa de B com assigneeId de A: recusado e B intacta', async () => {
    const before = JSON.stringify(await t.prisma.conversation.findUnique({ where: { id: b.conversation.id } }));
    const r = await t.as(t.B, 'POST', `/v1/conversations/${b.conversation.id}/assign`, { assigneeId: t.A.userId });
    expect([404, 422]).toContain(r.status);
    expect(JSON.stringify(await t.prisma.conversation.findUnique({ where: { id: b.conversation.id } }))).toBe(before);
  });
});
