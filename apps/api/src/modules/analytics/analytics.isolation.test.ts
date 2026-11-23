import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('isolamento entre workspaces: analytics', () => {
  let t: TwoTenants; let a: Fixtures; let b: Fixtures;
  beforeAll(async () => {
    t = await setupTwoTenants(); a = await t.fixtures(t.A); b = await t.fixtures(t.B);
    // Dados extras só em A, com números inconfundíveis.
    await t.prisma.usageRecord.create({ data: { workspaceId: t.A.workspaceId, kind: 'ai', quantity: 5, unit: 'tokens', costCents: 777 } });
    await t.prisma.outcome.createMany({ data: [1, 2, 3].map(() => ({ workspaceId: t.A.workspaceId, conversationId: a.conversation.id, contactId: a.contact.id, type: 'SALE' as any })) });
    await t.prisma.conversation.update({ where: { id: a.conversation.id }, data: { firstResponseAt: new Date(Date.now() + 1000) } });
    const pv = await t.prisma.playbook.findUniqueOrThrow({ where: { id: a.playbook.id } });
    await t.prisma.execution.create({ data: { workspaceId: t.A.workspaceId, conversationId: a.conversation.id, playbookVersionId: pv.activeVersionId!, status: 'FAILED' } });
  }, 60_000);
  afterAll(async () => { await t?.prisma.outcome.deleteMany({ where: { workspaceId: t.A.workspaceId } }).catch(() => undefined); await t?.teardown(); });

  it('sanidade: A enxerga os próprios números', async () => {
    const r = await t.as(t.A, 'GET', '/v1/analytics/overview?days=30');
    expect(r.status).toBe(200);
    expect(r.body.summary.costCents).toBe(777); expect(r.body.summary.outcomes).toBe(3); expect(r.body.summary.conversations).toBe(1);
  });
  it('overview de B: números só de B (sem custo, desfechos, falhas ou respostas de A)', async () => {
    for (const days of [7, 30, 90]) {
      const r = await t.as(t.B, 'GET', `/v1/analytics/overview?days=${days}`);
      expect(r.status).toBe(200);
      expect(r.body.summary.costCents).toBe(0);
      expect(r.body.summary.outcomes).toBe(0);
      expect(r.body.summary.conversations).toBe(1);
      expect(r.body.summary.leads).toBe(1);
      expect(r.body.summary.open).toBe(1);
      expect(r.body.summary.averageFirstResponseSeconds).toBeNull();
      expect(r.body.health.signals.find((s: any) => s.key === 'automations').status).toBe('operational');
    }
  });
  it('overview de B: listas (canais, atenção, fluxos) sem ids, nomes ou telefones de A', async () => {
    const r = await t.as(t.B, 'GET', '/v1/analytics/overview?days=30');
    const text = JSON.stringify(r.body);
    for (const leak of [a.channel.id, a.channel.displayName, a.conversation.id, a.contact.id, a.contact.phone, a.playbook.id, a.playbook.name]) expect(text).not.toContain(leak);
    expect(r.body.channels.map((c: any) => c.id)).toEqual([b.channel.id]);
    expect(r.body.byChannel.map((c: any) => c.id)).toEqual([b.channel.id]);
    expect(r.body.playbooks.map((p: any) => p.id)).toEqual([b.playbook.id]);
  });
  it('overview de B filtrando por channelId de A: zeros e nenhum dado de A', async () => {
    const r = await t.as(t.B, 'GET', `/v1/analytics/overview?days=30&channelId=${a.channel.id}`);
    expect(r.status).toBe(200);
    expect(r.body.summary.conversations).toBe(0); expect(r.body.summary.outcomes).toBe(0); expect(r.body.summary.open).toBe(0); expect(r.body.summary.leads).toBe(0);
    expect(r.body.attention).toEqual([]);
    expect(JSON.stringify(r.body)).not.toContain(a.channel.displayName);
  });
});
