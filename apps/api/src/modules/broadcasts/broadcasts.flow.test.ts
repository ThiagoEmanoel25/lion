import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('fluxo: broadcasts', () => {
  let t: TwoTenants; let fx: Fixtures;
  beforeAll(async () => { t = await setupTwoTenants(); fx = await t.fixtures(t.A); }, 60_000);
  afterAll(async () => { await t?.teardown(); });
  const mkContacts = async (n: number, extra: Record<string, unknown> = {}, tag = 'c') => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(await t.prisma.contact.create({ data: { workspaceId: t.A.workspaceId, phone: `+5511${tag}${Math.floor(Math.random() * 1e9)}`, name: `${tag}${i}`, consentAt: new Date(), ...extra } }));
    return out;
  };
  const body = (ids: string[], over: Record<string, unknown> = {}) => ({ name: 'Campanha', channelId: fx.channel.id, body: 'Olá!', startAt: new Date(Date.now() + 3600_000).toISOString(), minIntervalSeconds: 45, maxIntervalSeconds: 60, dailyQuota: 200, audience: { contactIds: ids }, ...over });

  it('caminho feliz: prévia, criar, iniciar, pausar, retomar, cancelar; só consentidos e não opt-out', async () => {
    const ok = await mkContacts(3, {}, '1');
    const noConsent = await mkContacts(1, { consentAt: null }, '2');
    const out = await mkContacts(1, { optedOutAt: new Date() }, '3');
    const ids = [...ok, ...noConsent, ...out].map(c => c.id);
    const pv = await t.as(t.A, 'POST', '/v1/broadcasts/preview', { audience: { contactIds: ids } });
    expect(pv.body).toMatchObject({ matched: 5, eligible: 3, skipped: { noConsent: 1, optedOut: 1 } });
    const c = await t.as(t.A, 'POST', '/v1/broadcasts', body(ids));
    expect(c.status).toBe(201);
    expect(c.body.progress.total).toBe(3);
    const id = c.body.id;
    expect((await t.as(t.A, 'POST', `/v1/broadcasts/${id}/start`)).status).toBe(200);
    expect((await t.as(t.A, 'POST', `/v1/broadcasts/${id}/start`)).status).toBe(409);
    const events = await t.prisma.outboxEvent.count({ where: { aggregate: 'BroadcastRecipient', processedAt: null, aggregateId: { in: (await t.prisma.broadcastRecipient.findMany({ where: { broadcastId: id } })).map(r => r.id) } } });
    expect(events).toBe(3);
    expect((await t.as(t.A, 'POST', `/v1/broadcasts/${id}/pause`)).status).toBe(200);
    expect((await t.as(t.A, 'POST', `/v1/broadcasts/${id}/start`)).status).toBe(200);
    expect((await t.as(t.A, 'POST', `/v1/broadcasts/${id}/cancel`)).status).toBe(200);
    expect((await t.as(t.A, 'POST', `/v1/broadcasts/${id}/cancel`)).status).toBe(409);
    const g = await t.as(t.A, 'GET', `/v1/broadcasts/${id}`);
    expect(g.body.progress.cancelled).toBe(3);
  });

  it('H2-08: retomar disparo pausado depois do horário planejado não pode soltar todos os destinatários de uma vez', async () => {
    const cs = await mkContacts(4, {}, '4');
    const c = await t.as(t.A, 'POST', '/v1/broadcasts', body(cs.map(x => x.id), { minIntervalSeconds: 45, maxIntervalSeconds: 60 }));
    const id = c.body.id;
    await t.as(t.A, 'POST', `/v1/broadcasts/${id}/start`);
    await t.as(t.A, 'POST', `/v1/broadcasts/${id}/pause`);
    // simula o tempo passando: horário planejado de todos já ficou no passado
    await t.prisma.broadcastRecipient.updateMany({ where: { broadcastId: id }, data: { scheduledFor: new Date(Date.now() - 3600_000) } });
    const before = new Date();
    await t.as(t.A, 'POST', `/v1/broadcasts/${id}/start`);
    const rids = (await t.prisma.broadcastRecipient.findMany({ where: { broadcastId: id } })).map(r => r.id);
    const ev = await t.prisma.outboxEvent.findMany({ where: { aggregate: 'BroadcastRecipient', processedAt: null, createdAt: { gte: before }, aggregateId: { in: rids } }, orderBy: { availableAt: 'asc' } });
    expect(ev.length).toBe(4);
    const spread = ev[ev.length - 1]!.availableAt.getTime() - ev[0]!.availableAt.getTime();
    expect(spread).toBeGreaterThanOrEqual(3 * 45_000);
  });

  it('H2-09: progress soma todos os estados (destinatários SKIPPED não somem do total)', async () => {
    const cs = await mkContacts(2, {}, '5');
    const c = await t.as(t.A, 'POST', '/v1/broadcasts', body(cs.map(x => x.id)));
    await t.prisma.broadcastRecipient.updateMany({ where: { broadcastId: c.body.id }, data: { status: 'SKIPPED', reason: 'x' } });
    const g = (await t.as(t.A, 'GET', `/v1/broadcasts/${c.body.id}`)).body.progress;
    expect(g.sent + g.pending + g.failed + g.cancelled + (g.skipped ?? 0)).toBe(g.total);
  });

  it('bordas: validações sem 500', async () => {
    const [c] = await mkContacts(1, {}, '6');
    const bad: Array<Record<string, unknown>> = [
      { minIntervalSeconds: 0 }, { minIntervalSeconds: -5 }, { maxIntervalSeconds: 1 }, { dailyQuota: 0 }, { dailyQuota: -1 }, { dailyQuota: 1e9 },
      { name: ' ' }, { body: '' }, { body: 'x'.repeat(4097) }, { startAt: 'amanhã' }, { startAt: new Date(Date.now() - 864e5).toISOString() },
      { channelId: 'xxx' }, { channelId: fx.channel.id.slice(0, -1) + 'z' }
    ];
    for (const over of bad) {
      const r = await t.as(t.A, 'POST', '/v1/broadcasts', body([c!.id], over));
      expect(r.status, JSON.stringify(over)).toBeLessThan(500);
      expect(r.status, JSON.stringify(over)).toBeGreaterThanOrEqual(400);
    }
  });

  it('H2-10: público vazio (sem filtros) não pode disparar para TODA a base', async () => {
    await mkContacts(2, {}, '7');
    const r = await t.as(t.A, 'POST', '/v1/broadcasts', body([], { audience: { tagIds: [], stages: [], contactIds: [] } }));
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it('canal desconectado: não cria nem inicia', async () => {
    const ch = await t.prisma.channel.create({ data: { workspaceId: t.A.workspaceId, provider: 'baileys', displayName: 'off', phoneNumber: '5511900000000', status: 'DISCONNECTED' } });
    const [c] = await mkContacts(1, {}, '8');
    expect((await t.as(t.A, 'POST', '/v1/broadcasts', body([c!.id], { channelId: ch.id }))).status).toBe(409);
  });
});
