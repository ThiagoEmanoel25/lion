import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('isolamento entre workspaces: billing', () => {
  let t: TwoTenants; let a: Fixtures; let b: Fixtures; const extraUsers: string[] = [];
  const tokenFor = async (role: 'ADMIN' | 'SUPERVISOR' | 'AGENT' | 'VIEWER') => {
    const u = await t.prisma.user.create({ data: { email: `${role.toLowerCase()}-${t.A.workspaceId}@example.test`, name: role, passwordHash: 'x' } });
    extraUsers.push(u.id);
    await t.prisma.membership.create({ data: { workspaceId: t.A.workspaceId, userId: u.id, role } });
    return t.app.jwt.sign({ userId: u.id, workspaceId: t.A.workspaceId, role });
  };
  beforeAll(async () => {
    t = await setupTwoTenants(); a = await t.fixtures(t.A); b = await t.fixtures(t.B);
    const now = new Date();
    await t.prisma.subscription.create({ data: { workspaceId: t.A.workspaceId, provider: 'stripe', externalId: `sub-${t.A.workspaceId}`, plan: 'scale', status: 'active', limits: {}, currentPeriodStart: new Date(now.getTime() - 86400_000), currentPeriodEnd: new Date(now.getTime() + 86400_000 * 20) } });
    await t.prisma.usageRecord.create({ data: { workspaceId: t.A.workspaceId, kind: 'ai', quantity: 99, unit: 'tokens', costCents: 4242 } });
  }, 60_000);
  afterAll(async () => { await t?.prisma.user.deleteMany({ where: { id: { in: extraUsers } } }).catch(() => undefined); await t?.teardown(); });

  it('sanidade: A vê plano scale e custo 4242', async () => {
    const r = await t.as(t.A, 'GET', '/v1/billing/overview');
    expect(r.status).toBe(200); expect(r.body.subscription.plan).toBe('scale'); expect(r.body.totals.costCents).toBe(4242);
  });
  it('GET /v1/billing/overview de B: plano free, uso e histórico sem dados de A', async () => {
    const r = await t.as(t.B, 'GET', '/v1/billing/overview');
    expect(r.status).toBe(200);
    expect(r.body.subscription.plan).toBe('free'); expect(r.body.subscription.id).toBeNull();
    expect(r.body.totals.costCents).toBe(0); expect(r.body.usage).toEqual([]);
    expect(r.body.history.subscriptions).toEqual([]);
    expect(r.body.resources.contacts.used).toBe(1); expect(r.body.resources.members.used).toBe(1); expect(r.body.resources.channels.used).toBe(1);
    expect(JSON.stringify(r.body)).not.toContain(`sub-${t.A.workspaceId}`);
  });
  it('GET /v1/billing/usage de B: sem assinatura nem uso de A', async () => {
    const r = await t.as(t.B, 'GET', '/v1/billing/usage');
    expect(r.status).toBe(200);
    expect(r.body.subscription).toBeNull(); expect(r.body.usage).toEqual([]);
  });
  it('RBAC em A: SUPERVISOR/AGENT/VIEWER não leem cobrança (403); ADMIN lê mas não gerencia', async () => {
    for (const role of ['SUPERVISOR', 'AGENT', 'VIEWER'] as const) {
      const token = await tokenFor(role);
      for (const url of ['/v1/billing/overview', '/v1/billing/usage']) expect((await t.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(403);
      expect((await t.app.inject({ method: 'POST', url: '/v1/billing/checkout', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(403);
    }
    const admin = await tokenFor('ADMIN');
    expect((await t.app.inject({ method: 'GET', url: '/v1/billing/overview', headers: { authorization: `Bearer ${admin}` } })).statusCode).toBe(200);
    for (const url of ['/v1/billing/checkout', '/v1/billing/portal']) expect((await t.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${admin}` } })).statusCode).toBe(403);
  });
  it('checkout/portal de OWNER: provedor indisponível (503), nada é criado em A', async () => {
    const n = await t.prisma.subscription.count({ where: { workspaceId: t.A.workspaceId } });
    for (const url of ['/v1/billing/checkout', '/v1/billing/portal']) expect((await t.as(t.B, 'POST', url)).status).toBe(503);
    expect(await t.prisma.subscription.count({ where: { workspaceId: t.A.workspaceId } })).toBe(n);
  });
});
