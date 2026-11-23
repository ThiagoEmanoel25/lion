import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('fluxo: saúde e erros de protocolo (error handler global)', () => {
  let t: TwoTenants;
  beforeAll(async () => { t = await setupTwoTenants(); }, 60_000);
  afterAll(async () => { await t?.teardown(); });
  const raw = (method: 'POST' | 'PATCH' | 'PUT', url: string, payload: string | undefined, headers: Record<string, string> = {}) =>
    t.app.inject({ method, url, payload, headers: { authorization: `Bearer ${t.A.token}`, ...headers } });

  it('/health e /ready respondem 200', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);
  });

  it('H2-15: JSON malformado deve responder 400, não 500', async () => {
    const r = await raw('POST', '/v1/contacts', '{"name":', { 'content-type': 'application/json' });
    expect(r.statusCode).toBe(400);
  });

  it('H2-16: POST sem corpo mas com Content-Type JSON (ação sem payload, como o front envia) não pode dar 500', async () => {
    const c = await t.prisma.channel.create({ data: { workspaceId: t.A.workspaceId, provider: 'baileys', displayName: 'ch', phoneNumber: '5511900001111', status: 'CONNECTED' } });
    const r = await raw('POST', `/v1/channels/${c.id}/disconnect`, undefined, { 'content-type': 'application/json' });
    expect(r.statusCode).toBeLessThan(500);
  });

  it('H2-17: Content-Type não suportado deve responder 415, não 500', async () => {
    const r = await raw('POST', '/v1/contacts', 'name=x', { 'content-type': 'application/x-www-form-urlencoded' });
    expect(r.statusCode).toBe(415);
  });

  it('H2-18: corpo acima do limite deve responder 413, não 500', async () => {
    const r = await raw('POST', '/v1/contacts/import', JSON.stringify({ csv: 'a'.repeat(12 * 1024 * 1024) }), { 'content-type': 'application/json' });
    expect(r.statusCode).toBe(413);
  });

  it('rota inexistente = 404 e sem token = 401', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/v1/nao-existe' })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/v1/contacts' })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/v1/contacts', headers: { authorization: 'Bearer lixo' } })).statusCode).toBe(401);
  });
});
