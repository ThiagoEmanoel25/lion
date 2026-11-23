import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';
import { webhookSignature } from './generic.js';

describe.skipIf(!hasTestDb)('fluxo: webhooks de entrada', () => {
  let t: TwoTenants; let fx: Fixtures; let ep: any;
  beforeAll(async () => {
    t = await setupTwoTenants(); fx = await t.fixtures(t.A);
    const r = await t.as(t.A, 'POST', '/v1/inbound-webhooks', { name: 'Leads', playbookId: fx.playbook.id, channelId: fx.channel.id, mapping: { phonePath: 'lead.phone', namePath: 'lead.name', variables: { plano: 'lead.plan' } } });
    expect(r.status).toBe(201); ep = r.body;
  }, 60_000);
  afterAll(async () => { await t?.teardown(); });

  const hit = (body: unknown, key: string | null = randomUUID(), secret = ep.secret) => {
    const raw = JSON.stringify(body); const ts = String(Math.floor(Date.now() / 1000));
    return t.app.inject({ method: 'POST', url: ep.path, payload: raw, headers: { 'content-type': 'application/json', 'x-leona-timestamp': ts, 'x-leona-signature': webhookSignature(secret, ts, raw), ...(key ? { 'idempotency-key': key } : {}) } });
  };

  it('caminho feliz + idempotência + assinatura + validações', async () => {
    const key = randomUUID();
    const a = await hit({ lead: { phone: '+5511977001001', name: 'Lia', plan: 'pro' } }, key);
    expect(a.statusCode).toBe(202);
    const b = await hit({ lead: { phone: '+5511977001001', name: 'Lia', plan: 'pro' } }, key);
    expect(b.statusCode).toBe(200); expect(b.json().duplicate).toBe(true);
    expect(await t.prisma.execution.count({ where: { workspaceId: t.A.workspaceId, context: { path: ['plano'], equals: 'pro' } } })).toBe(1);
    expect((await hit({ lead: { phone: '+5511977001001' } }, null)).statusCode).toBe(400);
    expect((await hit({ lead: { phone: '+5511977001001' } }, randomUUID(), 'whsec_errado')).statusCode).toBe(401);
    expect((await hit({ lead: {} })).statusCode).toBe(422);
    expect((await hit({ lead: { phone: '123' } })).statusCode).toBe(422);
    expect((await hit([1, 2])).statusCode).toBe(422);
    const logs = await t.as(t.A, 'GET', `/v1/inbound-webhooks/${ep.id}/logs?limit=2`);
    expect(logs.status).toBe(200);
    const rep = await t.as(t.A, 'POST', `/v1/inbound-webhooks/${ep.id}/logs/${logs.body.items[logs.body.items.length - 1].id}/replay`);
    expect(rep.status).toBeLessThan(500);
    const rot = await t.as(t.A, 'POST', `/v1/inbound-webhooks/${ep.id}/rotate-secret`);
    expect((await hit({ lead: { phone: '+5511977001002' } })).statusCode).toBe(401);
    ep.secret = rot.body.secret;
    expect((await hit({ lead: { phone: '+5511977001002' } })).statusCode).toBe(202);
  });

  it('H2-27: reenviar com a mesma Idempotency-Key um evento que FALHOU deve reprocessar (não responder "duplicate")', async () => {
    await t.prisma.playbook.update({ where: { id: fx.playbook.id }, data: { status: 'PAUSED' } });
    const key = randomUUID();
    const first = await hit({ lead: { phone: '+5511977002001' } }, key);
    expect(first.statusCode).toBe(409);
    await t.prisma.playbook.update({ where: { id: fx.playbook.id }, data: { status: 'PUBLISHED' } });
    const retry = await hit({ lead: { phone: '+5511977002001' } }, key);
    expect(retry.statusCode).toBe(202);
  });

  it('H2-28: telefone do webhook é normalizado como nos outros caminhos (+E164) e não duplica contato', async () => {
    await t.prisma.contact.create({ data: { workspaceId: t.A.workspaceId, phone: '+5511977003001', name: 'Existente' } });
    const r = await hit({ lead: { phone: '5511977003001', name: 'Mesmo número' } });
    expect(r.statusCode).toBe(202);
    expect(await t.prisma.contact.count({ where: { workspaceId: t.A.workspaceId, phone: { contains: '5511977003001' } } })).toBe(1);
  });

  it('H2-29: webhook respeita a cota mensal de execuções e a de contatos do plano', async () => {
    await t.prisma.subscription.create({ data: { workspaceId: t.A.workspaceId, provider: 'test', plan: 'free', status: 'active', limits: { contacts: 1, executionsMonthly: 0 }, currentPeriodStart: new Date(Date.now() - 864e5), currentPeriodEnd: new Date(Date.now() + 864e5) } });
    const r = await hit({ lead: { phone: '+5511977004001' } });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect(r.statusCode).toBeLessThan(500);
    await t.prisma.subscription.deleteMany({ where: { workspaceId: t.A.workspaceId } });
  });

  it('telefone canônico: contato legado sem "+" é reaproveitado e gravado como +E.164; novo contato nasce canônico', async () => {
    await t.prisma.contact.create({ data: { workspaceId: t.A.workspaceId, phone: '5511977006001', name: 'Legado' } });
    expect((await hit({ lead: { phone: '(11) 97700-6001' } })).statusCode).toBe(202);
    expect((await hit({ lead: { phone: '11 97700-6002' } })).statusCode).toBe(202);
    const rows = await t.prisma.contact.findMany({ where: { workspaceId: t.A.workspaceId, phone: { contains: '119770060' } }, orderBy: { phone: 'asc' } });
    expect(rows.map(r => r.phone)).toEqual(['+5511977006001', '+5511977006002']);
  });

  it('desativar webhook => 404', async () => {
    expect((await t.as(t.A, 'DELETE', `/v1/inbound-webhooks/${ep.id}`)).status).toBe(204);
    expect((await hit({ lead: { phone: '+5511977005001' } })).statusCode).toBe(404);
  });
});
