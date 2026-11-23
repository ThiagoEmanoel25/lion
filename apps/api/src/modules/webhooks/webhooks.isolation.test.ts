import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';

process.env.FIELD_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

describe.skipIf(!hasTestDb)('isolamento entre workspaces: webhooks de entrada (inbound-webhooks, logs e replay)', () => {
  let t: TwoTenants; let a: Fixtures; let b: Fixtures; let epA: any; let epB: any; let evA: any; let agentId = ''; let agentToken = '';
  const mapping = { phonePath: 'phone' };
  const snap = async () => JSON.stringify([
    await t.prisma.inboundWebhookEndpoint.findUnique({ where: { id: epA.id } }),
    await t.prisma.rawWebhookEvent.count({ where: { workspaceId: t.A.workspaceId } }),
    await t.prisma.execution.count({ where: { workspaceId: t.A.workspaceId } })
  ]);
  beforeAll(async () => {
    t = await setupTwoTenants(); a = await t.fixtures(t.A); b = await t.fixtures(t.B);
    const ra = await t.as(t.A, 'POST', '/v1/inbound-webhooks', { name: 'Hook A', playbookId: a.playbook.id, channelId: a.channel.id, mapping });
    const rb = await t.as(t.B, 'POST', '/v1/inbound-webhooks', { name: 'Hook B', playbookId: b.playbook.id, channelId: b.channel.id, mapping });
    expect(ra.status).toBe(201); expect(rb.status).toBe(201);
    epA = ra.body; epB = rb.body;
    evA = await t.prisma.rawWebhookEvent.create({ data: { workspaceId: t.A.workspaceId, channelId: a.channel.id, webhookEndpointId: epA.id, provider: `generic:${epA.publicId}`, externalId: 'evt-a-1', payload: { phone: '5511999990000' }, status: 'PROCESSED' } });
    const u = await t.prisma.user.create({ data: { email: `agent-${t.A.workspaceId}@example.test`, name: 'Agent', passwordHash: 'x' } });
    agentId = u.id; await t.prisma.membership.create({ data: { workspaceId: t.A.workspaceId, userId: u.id, role: 'AGENT' } });
    agentToken = t.app.jwt.sign({ userId: u.id, workspaceId: t.A.workspaceId, role: 'AGENT' });
  }, 60_000);
  afterAll(async () => { await t?.prisma.user.deleteMany({ where: { id: agentId } }).catch(() => undefined); await t?.teardown(); });

  it('GET /v1/inbound-webhooks: B não lista endpoints de A; nenhum segredo aparece', async () => {
    const r = await t.as(t.B, 'GET', '/v1/inbound-webhooks');
    expect(r.status).toBe(200);
    expect(r.body.map((x: any) => x.id)).toEqual([epB.id]);
    const text = JSON.stringify([r.body, (await t.as(t.A, 'GET', '/v1/inbound-webhooks')).body]);
    expect(text).not.toContain(epA.secret); expect(text).not.toContain(epB.secret);
    expect(text).not.toContain('encryptedSecret');
  });
  it('GET/PATCH/DELETE /v1/inbound-webhooks/:id de A por B: 404 e A intacto', async () => {
    const before = await snap();
    expect((await t.as(t.B, 'GET', `/v1/inbound-webhooks/${epA.id}`)).status).toBe(404);
    expect((await t.as(t.B, 'PATCH', `/v1/inbound-webhooks/${epA.id}`, { name: 'Invadido', isActive: false })).status).toBe(404);
    expect((await t.as(t.B, 'DELETE', `/v1/inbound-webhooks/${epA.id}`)).status).toBe(404);
    expect(await snap()).toBe(before);
  });
  it('POST rotate-secret de A por B: 404 e segredo de A inalterado', async () => {
    const before = await snap();
    const r = await t.as(t.B, 'POST', `/v1/inbound-webhooks/${epA.id}/rotate-secret`);
    expect(r.status).toBe(404); expect(JSON.stringify(r.body)).not.toContain('whsec_');
    expect(await snap()).toBe(before);
  });
  it('GET logs de A por B: 404; logs do próprio endpoint não trazem eventos de A (nem via cursor)', async () => {
    expect((await t.as(t.B, 'GET', `/v1/inbound-webhooks/${epA.id}/logs`)).status).toBe(404);
    const own = await t.as(t.B, 'GET', `/v1/inbound-webhooks/${epB.id}/logs?cursor=${evA.id}`);
    expect(JSON.stringify(own.body)).not.toContain(evA.id); expect(JSON.stringify(own.body)).not.toContain('5511999990000');
  });
  it('POST replay: evento de A pelo endpoint de A ou de B é recusado (404) e nada é criado', async () => {
    const before = await snap();
    expect((await t.as(t.B, 'POST', `/v1/inbound-webhooks/${epA.id}/logs/${evA.id}/replay`)).status).toBe(404);
    expect((await t.as(t.B, 'POST', `/v1/inbound-webhooks/${epB.id}/logs/${evA.id}/replay`)).status).toBe(404);
    expect(await snap()).toBe(before);
    expect(await t.prisma.rawWebhookEvent.count({ where: { workspaceId: t.B.workspaceId } })).toBe(0);
    expect(await t.prisma.contact.count({ where: { workspaceId: t.B.workspaceId, phone: '5511999990000' } })).toBe(0);
  });
  it('POST /v1/inbound-webhooks com playbookId/channelId de A: 422 e nada criado', async () => {
    const n = await t.prisma.inboundWebhookEndpoint.count({ where: { workspaceId: t.B.workspaceId } });
    expect((await t.as(t.B, 'POST', '/v1/inbound-webhooks', { name: 'X1', playbookId: a.playbook.id, channelId: b.channel.id, mapping })).status).toBe(422);
    expect((await t.as(t.B, 'POST', '/v1/inbound-webhooks', { name: 'X2', playbookId: b.playbook.id, channelId: a.channel.id, mapping })).status).toBe(422);
    expect(await t.prisma.inboundWebhookEndpoint.count({ where: { workspaceId: t.B.workspaceId } })).toBe(n);
  });
  it('PATCH de endpoint próprio com playbookId/channelId de A: 422 e endpoint de B intacto', async () => {
    const before = JSON.stringify(await t.prisma.inboundWebhookEndpoint.findUnique({ where: { id: epB.id } }));
    expect((await t.as(t.B, 'PATCH', `/v1/inbound-webhooks/${epB.id}`, { playbookId: a.playbook.id })).status).toBe(422);
    expect((await t.as(t.B, 'PATCH', `/v1/inbound-webhooks/${epB.id}`, { channelId: a.channel.id })).status).toBe(422);
    expect(JSON.stringify(await t.prisma.inboundWebhookEndpoint.findUnique({ where: { id: epB.id } }))).toBe(before);
  });
  it('RBAC em A: AGENT não lista, lê, altera, gira segredo, apaga nem reprocessa webhooks (403)', async () => {
    const before = await snap();
    const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => t.app.inject({ method, url, headers: { authorization: `Bearer ${agentToken}` }, ...(payload ? { payload: payload as object } : {}) });
    const base = `/v1/inbound-webhooks/${epA.id}`;
    expect([(await call('GET', '/v1/inbound-webhooks')).statusCode, (await call('GET', base)).statusCode, (await call('GET', `${base}/logs`)).statusCode]).toEqual([403, 403, 403]);
    expect((await call('POST', '/v1/inbound-webhooks', { name: 'N1', playbookId: a.playbook.id, channelId: a.channel.id, mapping })).statusCode).toBe(403);
    expect((await call('PATCH', base, { name: 'x' })).statusCode).toBe(403);
    expect((await call('DELETE', base)).statusCode).toBe(403);
    expect((await call('POST', `${base}/rotate-secret`)).statusCode).toBe(403);
    expect((await call('POST', `${base}/logs/${evA.id}/replay`)).statusCode).toBe(403);
    expect(await snap()).toBe(before);
  });
  it('sanidade: dono de A gira o segredo do próprio endpoint e replay cria evento só em A', async () => {
    const r = await t.as(t.A, 'POST', `/v1/inbound-webhooks/${epA.id}/rotate-secret`);
    expect(r.status).toBe(200); expect(r.body.secret).toMatch(/^whsec_/);
    const rep = await t.as(t.A, 'POST', `/v1/inbound-webhooks/${epA.id}/logs/${evA.id}/replay`);
    expect(rep.status).toBe(202);
    expect(await t.prisma.contact.count({ where: { workspaceId: t.B.workspaceId, phone: '5511999990000' } })).toBe(0);
    expect(await t.prisma.contact.count({ where: { workspaceId: t.A.workspaceId, phone: '+5511999990000' } })).toBe(1);
  });
});
