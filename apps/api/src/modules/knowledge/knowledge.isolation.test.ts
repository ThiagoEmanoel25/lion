import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('isolamento entre workspaces: knowledge', () => {
  let t: TwoTenants; let aSrc: { id: string }; let bSrc: { id: string };
  const snap = async () => JSON.stringify(await t.prisma.knowledgeSource.findUnique({ where: { id: aSrc.id }, include: { chunks: true } }));
  beforeAll(async () => {
    t = await setupTwoTenants();
    aSrc = await t.prisma.knowledgeSource.create({ data: { workspaceId: t.A.workspaceId, name: 'Fonte A segredo', kind: 'text', status: 'READY' } });
    await t.prisma.knowledgeChunk.create({ data: { workspaceId: t.A.workspaceId, sourceId: aSrc.id, ordinal: 0, content: 'conteudo-secreto-de-A' } });
    bSrc = await t.prisma.knowledgeSource.create({ data: { workspaceId: t.B.workspaceId, name: 'Fonte B', kind: 'text', status: 'READY' } });
  }, 60_000);
  afterAll(async () => { await t?.teardown(); });

  it('GET /v1/knowledge/sources: B só vê as suas', async () => {
    const r = await t.as(t.B, 'GET', '/v1/knowledge/sources');
    expect(r.status).toBe(200);
    const ids = r.body.map((s: any) => s.id);
    expect(ids).toContain(bSrc.id); expect(ids).not.toContain(aSrc.id);
    expect(JSON.stringify(r.body)).not.toContain('segredo');
  });
  it('DELETE /v1/knowledge/sources/:id de A por B: 404 e fonte/trechos de A intactos', async () => {
    const before = await snap();
    expect((await t.as(t.B, 'DELETE', `/v1/knowledge/sources/${aSrc.id}`)).status).toBe(404);
    expect(await snap()).toBe(before);
  });
  it('POST /v1/knowledge/sources por B: fonte e evento de indexação ficam em B', async () => {
    const r = await t.as(t.B, 'POST', '/v1/knowledge/sources', { name: 'Nova B', kind: 'text', content: 'texto b' });
    expect(r.status).toBe(202); expect(r.body.workspaceId).toBe(t.B.workspaceId);
    expect(await t.prisma.knowledgeSource.count({ where: { workspaceId: t.A.workspaceId } })).toBe(1);
    expect((await t.as(t.A, 'DELETE', `/v1/knowledge/sources/${r.body.id}`)).status).toBe(404);
    expect((await t.as(t.B, 'DELETE', `/v1/knowledge/sources/${r.body.id}`)).status).toBe(204);
  });
});
