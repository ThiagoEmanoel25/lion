import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('isolamento entre workspaces: broadcasts', () => {
  let t: TwoTenants; let a: Fixtures; let b: Fixtures; let bc: any; let viewerToken = ''; let viewerId = '';
  const snap = async () => JSON.stringify([
    await t.prisma.broadcast.findUnique({ where: { id: bc.id } }),
    await t.prisma.broadcastRecipient.findMany({ where: { broadcastId: bc.id }, orderBy: { id: 'asc' } }),
    await t.prisma.outboxEvent.count({ where: { workspaceId: t.A.workspaceId } })
  ]);
  const body = (over: Record<string, unknown> = {}) => ({ name: 'Disparo B', channelId: b.channel.id, body: 'oi', startAt: new Date(Date.now() + 3600_000).toISOString(), audience: { contactIds: [b.contact.id] }, ...over });
  beforeAll(async () => {
    t = await setupTwoTenants(); a = await t.fixtures(t.A); b = await t.fixtures(t.B);
    await t.prisma.contact.updateMany({ where: { id: { in: [a.contact.id, b.contact.id] } }, data: { consentAt: new Date() } });
    bc = await t.prisma.broadcast.create({ data: { workspaceId: t.A.workspaceId, channelId: a.channel.id, name: 'Disparo A', body: 'segredo A', startAt: new Date(Date.now() + 3600_000), createdById: t.A.userId } });
    await t.prisma.broadcastRecipient.create({ data: { broadcastId: bc.id, contactId: a.contact.id, scheduledFor: new Date(Date.now() + 3600_000) } });
    const user = await t.prisma.user.create({ data: { email: `viewer-${t.A.workspaceId}@example.test`, name: 'Viewer', passwordHash: 'x' } });
    await t.prisma.membership.create({ data: { workspaceId: t.A.workspaceId, userId: user.id, role: 'VIEWER' } });
    viewerId = user.id; viewerToken = t.app.jwt.sign({ userId: user.id, workspaceId: t.A.workspaceId, role: 'VIEWER' });
  }, 60_000);
  afterAll(async () => { await t?.prisma.user.deleteMany({ where: { id: viewerId } }).catch(() => undefined); await t?.teardown(); });

  it('GET /v1/broadcasts: B não lista disparos de A', async () => {
    const r = await t.as(t.B, 'GET', '/v1/broadcasts');
    expect(r.status).toBe(200);
    expect(r.body.map((x: any) => x.id)).not.toContain(bc.id);
    expect(JSON.stringify(r.body)).not.toContain('segredo A');
  });
  it('GET /v1/broadcasts/:id: 404', async () => {
    expect((await t.as(t.B, 'GET', `/v1/broadcasts/${bc.id}`)).status).toBe(404);
  });
  it('start/pause/cancel de disparo de A por B: 404 e A intacto', async () => {
    const before = await snap();
    for (const action of ['start', 'pause', 'cancel']) expect((await t.as(t.B, 'POST', `/v1/broadcasts/${bc.id}/${action}`)).status).toBe(404);
    expect(await snap()).toBe(before);
  });
  it('POST /v1/broadcasts com channelId de A: 404 e nada criado', async () => {
    const n = await t.prisma.broadcast.count({ where: { workspaceId: t.B.workspaceId } });
    expect((await t.as(t.B, 'POST', '/v1/broadcasts', body({ channelId: a.channel.id }))).status).toBe(404);
    expect(await t.prisma.broadcast.count({ where: { workspaceId: t.B.workspaceId } })).toBe(n);
  });
  it('POST /v1/broadcasts com contactIds/tagIds de A: público vazio (422), sem destinatários de A', async () => {
    const n = await t.prisma.broadcast.count({ where: { workspaceId: t.B.workspaceId } });
    expect((await t.as(t.B, 'POST', '/v1/broadcasts', body({ audience: { contactIds: [a.contact.id] } }))).status).toBe(422);
    await t.prisma.contactTag.create({ data: { contactId: a.contact.id, tagId: a.tag.id } });
    expect((await t.as(t.B, 'POST', '/v1/broadcasts', body({ audience: { tagIds: [a.tag.id] } }))).status).toBe(422);
    expect(await t.prisma.broadcast.count({ where: { workspaceId: t.B.workspaceId } })).toBe(n);
  });
  it('POST /v1/broadcasts misturando contato de A e de B: só B entra', async () => {
    const r = await t.as(t.B, 'POST', '/v1/broadcasts', body({ audience: { contactIds: [a.contact.id, b.contact.id] } }));
    expect(r.status).toBe(201);
    const rec = await t.prisma.broadcastRecipient.findMany({ where: { broadcastId: r.body.id } });
    expect(rec.map(x => x.contactId)).toEqual([b.contact.id]);
  });
  it('POST /v1/broadcasts/preview: contagens ignoram A', async () => {
    const r = await t.as(t.B, 'POST', '/v1/broadcasts/preview', { audience: { contactIds: [a.contact.id] } });
    expect(r.status).toBe(200); expect(r.body.matched).toBe(0); expect(r.body.eligible).toBe(0);
    const all = await t.as(t.B, 'POST', '/v1/broadcasts/preview', { audience: {} });
    expect(all.body.matched).toBe(1);
  });
  it('RBAC: VIEWER de A não cria nem inicia/pausa/cancela disparo de A (403) e A fica intacto', async () => {
    const before = await snap();
    const call = (m: 'GET' | 'POST', url: string, payload?: unknown) => t.app.inject({ method: m, url, headers: { authorization: `Bearer ${viewerToken}` }, ...(payload ? { payload: payload as object } : {}) });
    for (const action of ['start', 'pause', 'cancel']) expect((await call('POST', `/v1/broadcasts/${bc.id}/${action}`)).statusCode).toBe(403);
    expect((await call('POST', '/v1/broadcasts', { name: 'X', channelId: a.channel.id, body: 'x', startAt: new Date(Date.now() + 3600_000).toISOString(), audience: { contactIds: [a.contact.id] } })).statusCode).toBe(403);
    expect((await call('POST', '/v1/broadcasts/preview', { audience: {} })).statusCode).toBe(403);
    expect(await snap()).toBe(before);
  });
});
