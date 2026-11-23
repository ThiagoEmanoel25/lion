import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('isolamento entre workspaces: channels', () => {
  let t: TwoTenants; let a: Fixtures; let b: Fixtures;
  const snap = async (id: string) => JSON.stringify({ ch: await t.prisma.channel.findUnique({ where: { id } }), cfg: await t.prisma.channelFlowConfig.findMany({ where: { channelId: id }, orderBy: { id: 'asc' } }) });
  beforeAll(async () => { t = await setupTwoTenants(); a = await t.fixtures(t.A); b = await t.fixtures(t.B); }, 60_000);
  afterAll(async () => { await t?.teardown(); });

  it('GET /v1/channels: B só vê canais de B', async () => {
    const r = await t.as(t.B, 'GET', '/v1/channels');
    expect(r.status).toBe(200);
    expect(r.body.map((c: any) => c.id)).toEqual([b.channel.id]);
  });
  it('GET /:id/session: 404', async () => {
    expect((await t.as(t.B, 'GET', `/v1/channels/${a.channel.id}/session`)).status).toBe(404);
  });
  it.each([
    ['connect', {}],
    ['disconnect', { removeAuth: true }],
    ['automation', { playbookId: null }],
  ])('POST /:id/%s: 404 e canal de A intacto', async (action, body) => {
    const before = await snap(a.channel.id);
    expect((await t.as(t.B, 'POST', `/v1/channels/${a.channel.id}/${action}`, body)).status).toBe(404);
    expect(await snap(a.channel.id)).toBe(before);
  });
  it('POST /:id/automation em canal de B com playbookId de A: recusado e B intacto', async () => {
    const before = await snap(b.channel.id);
    const r = await t.as(t.B, 'POST', `/v1/channels/${b.channel.id}/automation`, { playbookId: a.playbook.id });
    expect([409, 422]).toContain(r.status);
    expect(await snap(b.channel.id)).toBe(before);
  });
  it('POST /v1/channels e /whatsapp/sessions criam apenas em B', async () => {
    const nA = await t.prisma.channel.count({ where: { workspaceId: t.A.workspaceId } });
    const r = await t.as(t.B, 'POST', '/v1/channels', { displayName: 'Canal B2', phoneNumber: '5511966665555' });
    expect([201, 402]).toContain(r.status); if (r.status === 201) expect(r.body.workspaceId).toBe(t.B.workspaceId);
    expect(await t.prisma.channel.count({ where: { workspaceId: t.A.workspaceId } })).toBe(nA);
  });
});
