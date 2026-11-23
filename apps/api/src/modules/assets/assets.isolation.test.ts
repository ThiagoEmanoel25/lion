import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('isolamento entre workspaces: assets', () => {
  let t: TwoTenants; let aAsset: { id: string };
  const snap = async () => JSON.stringify(await t.prisma.playbookAsset.findUnique({ where: { id: aAsset.id } }));
  beforeAll(async () => {
    t = await setupTwoTenants();
    aAsset = await t.prisma.playbookAsset.create({ data: { workspaceId: t.A.workspaceId, fileName: 'a.png', contentType: 'image/png', size: 4, data: Buffer.from([137, 80, 78, 71]) } });
  }, 60_000);
  afterAll(async () => { await t?.teardown(); });

  it('GET /v1/playbook-assets/:id de A por B: 404 (mesmo corpo de um id inexistente)', async () => {
    const r = await t.as(t.B, 'GET', `/v1/playbook-assets/${aAsset.id}`);
    const missing = await t.as(t.B, 'GET', '/v1/playbook-assets/cm0000000000000000000000x');
    expect(r.status).toBe(404); expect(missing.status).toBe(404);
    expect(r.raw.body).not.toContain('PNG');
    expect((await t.as(t.A, 'GET', `/v1/playbook-assets/${aAsset.id}`)).status).toBe(200);
  });
  it('DELETE /v1/playbook-assets/:id de A por B: 404 e arquivo intacto', async () => {
    const before = await snap();
    expect((await t.as(t.B, 'DELETE', `/v1/playbook-assets/${aAsset.id}`)).status).toBe(404);
    expect(await snap()).toBe(before);
  });
  it('POST upload por B cria o arquivo em B (nunca em A) e A não o enxerga', async () => {
    const nA = await t.prisma.playbookAsset.count({ where: { workspaceId: t.A.workspaceId } });
    const raw = await t.app.inject({ method: 'POST', url: '/v1/playbook-assets', headers: { authorization: `Bearer ${t.B.token}`, 'content-type': 'application/octet-stream', 'x-file-name': 'b.png', 'x-file-content-type': 'image/png' }, payload: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]) });
    expect(raw.statusCode).toBe(201);
    const id = raw.json().id;
    expect((await t.prisma.playbookAsset.findUnique({ where: { id } }))?.workspaceId).toBe(t.B.workspaceId);
    expect(await t.prisma.playbookAsset.count({ where: { workspaceId: t.A.workspaceId } })).toBe(nA);
    expect((await t.as(t.A, 'GET', `/v1/playbook-assets/${id}`)).status).toBe(404);
    expect((await t.as(t.A, 'DELETE', `/v1/playbook-assets/${id}`)).status).toBe(404);
    expect((await t.as(t.B, 'GET', `/v1/playbook-assets/${id}`)).status).toBe(200);
  });
});
