import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('fluxo: pixels', () => {
  let t: TwoTenants;
  beforeAll(async () => { t = await setupTwoTenants(); }, 60_000);
  afterAll(async () => { await t?.teardown(); });
  const body = (over: Record<string, unknown> = {}) => ({ name: 'Pixel Loja', pixelId: '123456789012345', accessToken: 'EAAB-token-muito-secreto-1234', ...over });

  it('caminho feliz: criar, listar sem segredo, editar, duplicado, excluir', async () => {
    const c = await t.as(t.A, 'POST', '/v1/workspace/pixels', body());
    expect(c.status).toBe(201);
    expect(JSON.stringify(c.body)).not.toContain('muito-secreto');
    expect((await t.as(t.A, 'POST', '/v1/workspace/pixels', body())).status).toBe(409);
    const list = await t.as(t.A, 'GET', '/v1/workspace/pixels');
    expect(JSON.stringify(list.body)).not.toContain('EAAB');
    const p = await t.as(t.A, 'PATCH', `/v1/workspace/pixels/${c.body.id}`, { pageId: '999' });
    expect(p.status).toBe(200); expect(p.body.name).toBe('Pixel Loja'); expect(p.body.pixelId).toBe('123456789012345');
    const p2 = await t.as(t.A, 'POST', '/v1/workspace/pixels', body({ name: 'Outro' }));
    expect((await t.as(t.A, 'PATCH', `/v1/workspace/pixels/${p2.body.id}`, { name: 'Pixel Loja' })).status).toBe(409);
    expect((await t.as(t.A, 'POST', `/v1/workspace/pixels/${c.body.id}/test-event`)).status).toBe(422);
    for (const bad of [{ pixelId: 'abc' }, { pixelId: '123' }, { accessToken: 'curto' }, { name: '' }, { name: 'x'.repeat(81) }]) expect((await t.as(t.A, 'POST', '/v1/workspace/pixels', body(bad))).status).toBe(422);
    expect((await t.as(t.A, 'DELETE', `/v1/workspace/pixels/${c.body.id}`)).status).toBe(204);
    expect((await t.as(t.A, 'DELETE', `/v1/workspace/pixels/${c.body.id}`)).status).toBe(404);
  });
});
