import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type TwoTenants } from '../../test/two-tenants.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5a60000000049454e44ae426082', 'hex');

describe.skipIf(!hasTestDb)('fluxo: assets', () => {
  let t: TwoTenants;
  beforeAll(async () => { t = await setupTwoTenants(); }, 60_000);
  afterAll(async () => { await t?.teardown(); });
  const up = (data: Buffer | string, name = 'foto.png', type = 'image/png', ct = 'application/octet-stream') => t.app.inject({ method: 'POST', url: '/v1/playbook-assets', payload: data, headers: { authorization: `Bearer ${t.A.token}`, 'content-type': ct, 'x-file-name': encodeURIComponent(name), 'x-file-content-type': type } });

  it('caminho feliz: enviar PNG, baixar, nome unicode, excluir', async () => {
    const r = await up(PNG, 'Promoção Ñ 日本.png');
    expect(r.statusCode).toBe(201);
    const { id, fileName } = r.json();
    expect(fileName).toBe('Promoção Ñ 日本.png');
    const g = await t.as(t.A, 'GET', `/v1/playbook-assets/${id}`);
    expect(g.status).toBe(200);
    expect((await t.as(t.B, 'GET', `/v1/playbook-assets/${id}`)).status).toBe(404);
    expect((await t.as(t.A, 'DELETE', `/v1/playbook-assets/${id}`)).status).toBe(204);
    expect((await t.as(t.A, 'GET', `/v1/playbook-assets/${id}`)).status).toBe(404);
  });

  it('H2-53: envio do mesmo arquivo duas vezes / arquivo vazio / sem nome / tipo errado não dá 500', async () => {
    expect((await up(PNG)).statusCode).toBe(201);
    expect((await up(PNG)).statusCode).toBe(201);
    const out: Record<string, number> = {
      vazio: (await up(Buffer.alloc(0))).statusCode,
      magicErrado: (await up(Buffer.from('MZ-not-a-png'), 'x.png')).statusCode,
      tipoInvalido: (await up(PNG, 'a.png', 'nao/valido/demais')).statusCode,
      ctJson: (await up(PNG, 'a.png', 'image/png', 'application/json')).statusCode
    };
    expect(Object.values(out).every(c => c < 500), JSON.stringify(out)).toBe(true);
  });

  it('H2-54: arquivo acima de 10 MB responde 413 (não 500)', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 10, 1);
    expect((await up(big)).statusCode).toBe(413);
  });
});
