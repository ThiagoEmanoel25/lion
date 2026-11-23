import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('fluxo: analytics', () => {
  let t: TwoTenants; let fx: Fixtures;
  beforeAll(async () => { t = await setupTwoTenants(); fx = await t.fixtures(t.A); }, 60_000);
  afterAll(async () => { await t?.teardown(); });

  it('overview: 7/30/90 dias, filtro de canal, parâmetros inválidos sem 500', async () => {
    for (const q of ['', '?days=7', '?days=30', '?days=90', `?channelId=${fx.channel.id}`, '?channelId=naoexiste']) expect((await t.as(t.A, 'GET', `/v1/analytics/overview${q}`)).status, q).toBe(200);
    expect((await t.as(t.A, 'GET', '/v1/analytics/overview?days=15')).status).toBe(422);
    expect((await t.as(t.A, 'GET', '/v1/analytics/overview?days=abc')).status).toBe(422);
  });

  it('H2-44: taxa de desfecho nunca passa de 100% (desfechos de conversas antigas não entram sobre as novas)', async () => {
    const old = await t.prisma.conversation.create({ data: { workspaceId: t.A.workspaceId, channelId: fx.channel.id, contactId: fx.contact.id, status: 'RESOLVED', createdAt: new Date(Date.now() - 60 * 864e5) } });
    const older = await t.prisma.conversation.create({ data: { workspaceId: t.A.workspaceId, channelId: fx.channel.id, contactId: fx.contact.id, status: 'RESOLVED', createdAt: new Date(Date.now() - 61 * 864e5) } });
    for (const c of [old, older]) await t.prisma.outcome.create({ data: { workspaceId: t.A.workspaceId, conversationId: c.id, contactId: fx.contact.id, type: 'QUALIFIED', occurredAt: new Date() } } as any);
    const o = (await t.as(t.A, 'GET', '/v1/analytics/overview?days=7')).body;
    expect(o.summary.outcomeRate).toBeLessThanOrEqual(1);
  });

  it('H2-45: série diária usa o fuso do workspace (como o gráfico por hora), não UTC', async () => {
    await t.prisma.workspace.update({ where: { id: t.A.workspaceId }, data: { timezone: 'America/Bahia' } }); // UTC-3
    const createdAt = new Date(); createdAt.setUTCHours(1, 0, 0, 0); // 22:00 locais do dia anterior
    if (createdAt > new Date()) createdAt.setUTCDate(createdAt.getUTCDate() - 1);
    const localDay = new Date(createdAt.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
    const utcDay = createdAt.toISOString().slice(0, 10);
    expect(localDay).not.toBe(utcDay);
    const c = await t.prisma.conversation.create({ data: { workspaceId: t.A.workspaceId, channelId: fx.channel.id, contactId: fx.contact.id, status: 'NEW', createdAt } });
    const o = (await t.as(t.A, 'GET', '/v1/analytics/overview?days=7')).body;
    expect(o.series.find((p: any) => p.date === localDay)?.conversations ?? 0).toBeGreaterThanOrEqual(1);
    await t.prisma.conversation.delete({ where: { id: c.id } });
  });
});
