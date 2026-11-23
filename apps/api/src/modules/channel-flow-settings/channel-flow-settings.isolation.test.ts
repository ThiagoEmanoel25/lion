import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('isolamento entre workspaces: channel-flow-settings', () => {
  let t: TwoTenants; let a: Fixtures; let b: Fixtures;
  const empty = { WELCOME: null, DEFAULT_RESPONSE: null, CONVERSATION_RESOLVED: null, HANDOFF_CLOSED: null };
  const snap = async (id: string) => JSON.stringify({
    ch: await t.prisma.channel.findUnique({ where: { id } }),
    cfg: await t.prisma.channelFlowConfig.findMany({ where: { channelId: id }, orderBy: { id: 'asc' } }),
    kw: await t.prisma.channelKeyword.findMany({ where: { channelId: id }, orderBy: { id: 'asc' } }),
  });
  beforeAll(async () => {
    t = await setupTwoTenants(); a = await t.fixtures(t.A); b = await t.fixtures(t.B);
    await t.prisma.channelFlowConfig.create({ data: { channelId: a.channel.id, slot: 'WELCOME', playbookId: a.playbook.id } });
    await t.prisma.channelKeyword.create({ data: { channelId: a.channel.id, keyword: 'oi', normalizedKeyword: 'oi', match: 'EXACT', playbookId: a.playbook.id } });
  }, 60_000);
  afterAll(async () => { await t?.teardown(); });

  it('GET /v1/channel-flow-settings: sem canais nem fluxos de A', async () => {
    const r = await t.as(t.B, 'GET', '/v1/channel-flow-settings');
    expect(r.status).toBe(200);
    expect(r.body.channels.map((c: any) => c.id)).toEqual([b.channel.id]);
    expect(r.body.playbooks.map((p: any) => p.id)).toEqual([b.playbook.id]);
  });
  it('PUT /channels/:id/flow-settings em canal de A: 404 e A intacto', async () => {
    const before = await snap(a.channel.id);
    const r = await t.as(t.B, 'PUT', `/v1/channels/${a.channel.id}/flow-settings`, { slots: empty, keywords: [] });
    expect(r.status).toBe(404);
    expect(await snap(a.channel.id)).toBe(before);
  });
  it('POST /bulk com canal de A (sozinho ou junto de B): 404 e nada alterado', async () => {
    const [sa, sb] = [await snap(a.channel.id), await snap(b.channel.id)];
    expect((await t.as(t.B, 'POST', '/v1/channel-flow-settings/bulk', { slots: empty, keywords: [], channelIds: [a.channel.id] })).status).toBe(404);
    expect((await t.as(t.B, 'POST', '/v1/channel-flow-settings/bulk', { slots: empty, keywords: [], channelIds: [b.channel.id, a.channel.id] })).status).toBe(404);
    expect(await snap(a.channel.id)).toBe(sa); expect(await snap(b.channel.id)).toBe(sb);
  });
  it('PUT/bulk em canal de B com playbookId de A (slot ou keyword): 422 e B intacto', async () => {
    const sb = await snap(b.channel.id);
    const bad = { ...empty, WELCOME: a.playbook.id };
    expect((await t.as(t.B, 'PUT', `/v1/channels/${b.channel.id}/flow-settings`, { slots: bad, keywords: [] })).status).toBe(422);
    expect((await t.as(t.B, 'PUT', `/v1/channels/${b.channel.id}/flow-settings`, { slots: empty, keywords: [{ keyword: 'x', match: 'EXACT', playbookId: a.playbook.id }] })).status).toBe(422);
    expect((await t.as(t.B, 'POST', '/v1/channel-flow-settings/bulk', { slots: bad, keywords: [], channelIds: [b.channel.id] })).status).toBe(422);
    expect(await snap(b.channel.id)).toBe(sb);
  });
  it('PUT legítimo em canal de B afeta só B', async () => {
    const sa = await snap(a.channel.id);
    const r = await t.as(t.B, 'PUT', `/v1/channels/${b.channel.id}/flow-settings`, { slots: { ...empty, WELCOME: b.playbook.id }, keywords: [] });
    expect(r.status).toBe(200);
    expect(await snap(a.channel.id)).toBe(sa);
  });
});
