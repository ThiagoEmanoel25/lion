import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('fluxo: billing e cotas', () => {
  let t: TwoTenants; let fx: Fixtures;
  beforeAll(async () => { t = await setupTwoTenants(); fx = await t.fixtures(t.A); }, 60_000);
  afterAll(async () => { await t?.teardown(); });
  const sub = (workspaceId: string, limits: object, over: object = {}) => t.prisma.subscription.create({ data: { workspaceId, provider: 'test', plan: 'free', status: 'active', limits, currentPeriodStart: new Date(Date.now() - 864e5), currentPeriodEnd: new Date(Date.now() + 864e5), ...over } });

  it('overview/usage/checkout/portal respondem sem 500', async () => {
    const o = await t.as(t.A, 'GET', '/v1/billing/overview');
    expect(o.status).toBe(200); expect(o.body.resources.contacts.limit).toBe(250);
    expect((await t.as(t.A, 'GET', '/v1/billing/usage')).status).toBe(200);
    expect((await t.as(t.A, 'POST', '/v1/billing/checkout', {})).status).toBe(503);
    expect((await t.as(t.A, 'POST', '/v1/billing/portal', {})).status).toBe(503);
  });

  it('assinatura expirada/cancelada volta ao plano free (não zera as cotas nem libera tudo)', async () => {
    await sub(t.B.workspaceId, { contacts: 5000 }, { status: 'canceled' });
    const o = await t.as(t.B, 'GET', '/v1/billing/overview');
    expect(o.body.resources.contacts.limit).toBe(250);
  });

  it('H2-43: abrir conversa manual para número novo respeita a cota de contatos', async () => {
    await sub(t.A.workspaceId, { contacts: 1 });
    const r = await t.as(t.A, 'POST', '/v1/conversations', { channelId: fx.channel.id, phone: '5511977009999', name: 'Extra' });
    expect(r.status).toBe(402);
  });

  it('limites negativos/estranhos no JSON de limites não derrubam o overview', async () => {
    await t.prisma.subscription.deleteMany({ where: { workspaceId: t.A.workspaceId } });
    await sub(t.A.workspaceId, { contacts: -1, members: 'x', channels: null, executionsMonthly: 1.9 });
    const o = await t.as(t.A, 'GET', '/v1/billing/overview');
    expect(o.status).toBe(200);
  });
});
