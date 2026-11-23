import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('isolamento entre workspaces: pixels', () => {
  let t: TwoTenants; let aPx: { id: string; name: string }; let bPx: { id: string };
  const snap = async () => JSON.stringify(await t.prisma.metaPixel.findUnique({ where: { id: aPx.id }, omit: { accessTokenEncrypted: false } }));
  beforeAll(async () => {
    process.env.FIELD_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
    t = await setupTwoTenants();
    aPx = await t.prisma.metaPixel.create({ data: { workspaceId: t.A.workspaceId, name: 'Pixel Compartilhado', pixelId: '1234567', accessTokenEncrypted: 'cifrado-a', accessTokenLast4: 'AAAA', testEventCode: 'TEST1' } });
    bPx = await t.prisma.metaPixel.create({ data: { workspaceId: t.B.workspaceId, name: 'Pixel B', pixelId: '7654321', accessTokenEncrypted: 'cifrado-b', accessTokenLast4: 'BBBB' } });
  }, 60_000);
  afterAll(async () => { await t?.teardown(); });

  it('GET /v1/workspace/pixels: B só vê os seus', async () => {
    const r = await t.as(t.B, 'GET', '/v1/workspace/pixels'); expect(r.status).toBe(200);
    expect(r.body.map((p: any) => p.id)).toEqual([bPx.id]);
    expect(JSON.stringify(r.body)).not.toContain('AAAA');
  });
  it('PATCH/DELETE/test-event em pixel de A por B: 404 e pixel intacto', async () => {
    const before = await snap();
    expect((await t.as(t.B, 'PATCH', `/v1/workspace/pixels/${aPx.id}`, { name: 'Invadido', accessToken: 'token-invasor-123' })).status).toBe(404);
    expect((await t.as(t.B, 'DELETE', `/v1/workspace/pixels/${aPx.id}`)).status).toBe(404);
    expect((await t.as(t.B, 'POST', `/v1/workspace/pixels/${aPx.id}/test-event`)).status).toBe(404);
    expect(await snap()).toBe(before);
  });
  it('POST por B com o mesmo nome do pixel de A cria em B sem tocar A', async () => {
    const r = await t.as(t.B, 'POST', '/v1/workspace/pixels', { name: aPx.name, pixelId: '9999999', accessToken: 'token-b-valido-123' });
    expect(r.status).toBe(201);
    expect((await t.prisma.metaPixel.findUnique({ where: { id: r.body.id } }))?.workspaceId).toBe(t.B.workspaceId);
    expect((await t.as(t.A, 'PATCH', `/v1/workspace/pixels/${r.body.id}`, { name: 'xx' })).status).toBe(404);
    expect((await t.as(t.A, 'DELETE', `/v1/workspace/pixels/${r.body.id}`)).status).toBe(404);
  });
  it('PATCH de pixel de B com nome já usado só em A não colide; renomear ok', async () => {
    expect((await t.as(t.B, 'PATCH', `/v1/workspace/pixels/${bPx.id}`, { name: 'Outro nome B' })).status).toBe(200);
  });
});
