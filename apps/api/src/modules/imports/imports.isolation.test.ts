import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';

const leona = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/leona-flow.redacted.json', import.meta.url)), 'utf8'));

describe.skipIf(!hasTestDb)('isolamento entre workspaces: imports', () => {
  let t: TwoTenants; let a: Fixtures; let b: Fixtures;
  let aFlow: { id: string }; let aTarget: { id: string }; let aPixel: { id: string }; let aTag: { id: string }; let aAsset: { id: string };
  let shareCode: string; let shareId: string; let aSession: string;
  const flowSnap = async () => JSON.stringify([await t.prisma.playbook.findMany({ where: { workspaceId: t.A.workspaceId }, orderBy: { id: 'asc' } }), await t.prisma.playbookVersion.findMany({ where: { playbook: { workspaceId: t.A.workspaceId } }, orderBy: { id: 'asc' } })]);
  const shareSnap = async () => JSON.stringify(await t.prisma.flowShareCode.findMany({ where: { workspaceId: t.A.workspaceId }, orderBy: { id: 'asc' } }));

  beforeAll(async () => {
    t = await setupTwoTenants(); a = await t.fixtures(t.A); b = await t.fixtures(t.B);
    aTag = await t.prisma.tag.create({ data: { workspaceId: t.A.workspaceId, name: 'tag-secreta-A' } });
    aPixel = await t.prisma.metaPixel.create({ data: { workspaceId: t.A.workspaceId, name: 'Pixel Secreto A', pixelId: '1234567', accessTokenEncrypted: 'x', accessTokenLast4: 'AAAA' } });
    aTarget = await t.prisma.playbook.create({ data: { workspaceId: t.A.workspaceId, name: 'Destino Secreto A' } });
    aAsset = await t.prisma.playbookAsset.create({ data: { workspaceId: t.A.workspaceId, fileName: 'a.png', contentType: 'image/png', size: 3, data: Buffer.from([1, 2, 3]) } });
    const node = (id: string, kind: string, config: Record<string, unknown>) => ({ id, kind, name: id, config, position: { x: 0, y: 0 } });
    const definition = { start: 's', nodes: [
      node('s', 'trigger', {}), node('tag', 'tag', { tagIds: [aTag.id] }),
      node('kb', 'kanban', { boardId: a.board.id, columnId: a.column.id, mode: 'create_or_move' }),
      node('px', 'pixel', { pixelId: aPixel.id, eventName: 'ViewContent' }),
      node('img', 'image', { url: `nexo-asset://${aAsset.id}` }),
      node('jump', 'flow_jump', { targetPlaybookId: aTarget.id }), node('end', 'outcome', { type: 'RESOLVED' })
    ], edges: [{ id: 'e1', source: 's', target: 'tag' }], settings: { maxSteps: 10, timeoutSeconds: 60 } };
    aFlow = await t.prisma.playbook.create({ data: { workspaceId: t.A.workspaceId, name: 'Fluxo A compartilhado', versions: { create: { version: 1, definition: definition as any, checksum: 'c1', createdById: t.A.userId } } } });
    const sc = await t.as(t.A, 'POST', `/v1/playbooks/${aFlow.id}/share-codes`, {}); expect(sc.status).toBe(201);
    shareCode = sc.body.code; shareId = sc.body.id;
    const ss = await t.as(t.A, 'POST', '/v1/imports/leona/sessions', {}); expect(ss.status).toBe(201); aSession = ss.body.code;
  }, 60_000);
  afterAll(async () => { await t?.teardown(); });

  it('rotas de share-codes com :id de A por B: 404 e códigos de A intactos', async () => {
    const before = await shareSnap(); const flows = await flowSnap();
    expect((await t.as(t.B, 'POST', `/v1/playbooks/${aFlow.id}/share-codes`, {})).status).toBe(404);
    expect((await t.as(t.B, 'GET', `/v1/playbooks/${aFlow.id}/share-codes`)).status).toBe(404);
    expect((await t.as(t.B, 'DELETE', `/v1/playbooks/${aFlow.id}/share-codes/${shareId}`)).status).toBe(404);
    // mesmo com um :id de fluxo do próprio B, o shareId de A não pode ser revogado
    expect((await t.as(t.B, 'DELETE', `/v1/playbooks/${b.playbook.id}/share-codes/${shareId}`)).status).toBe(404);
    expect(await shareSnap()).toBe(before); expect(await flowSnap()).toBe(flows);
    expect(await t.prisma.flowShareCode.count({ where: { playbookId: aFlow.id } })).toBe(1);
  });

  it('sessões de importação Leona: B não vê o código de A; sessão criada por B pertence a B', async () => {
    expect((await t.as(t.B, 'GET', `/v1/imports/leona/sessions/${aSession}`)).status).toBe(404);
    expect((await t.as(t.A, 'GET', `/v1/imports/leona/sessions/${aSession}`)).status).toBe(200);
    const s = await t.as(t.B, 'POST', '/v1/imports/leona/sessions', {}); expect(s.status).toBe(201);
    expect((await t.prisma.flowImportSession.findUnique({ where: { code: s.body.code } }))?.workspaceId).toBe(t.B.workspaceId);
    expect((await t.as(t.A, 'GET', `/v1/imports/leona/sessions/${s.body.code}`)).status).toBe(404);
  });

  it('importação Leona pelo código de B cria só em B e não toca nos fluxos de A', async () => {
    const s = await t.as(t.B, 'POST', '/v1/imports/leona/sessions', {});
    const flows = await flowSnap(); const nA = await t.prisma.playbook.count({ where: { workspaceId: t.A.workspaceId } });
    const r = await t.app.inject({ method: 'POST', url: `/v1/imports/leona/${s.body.code}`, payload: leona });
    expect(r.statusCode).toBe(201);
    const ses = await t.prisma.flowImportSession.findUniqueOrThrow({ where: { code: s.body.code } });
    expect((await t.prisma.playbook.findUniqueOrThrow({ where: { id: ses.playbookId! } })).workspaceId).toBe(t.B.workspaceId);
    expect(await t.prisma.playbook.count({ where: { workspaceId: t.A.workspaceId } })).toBe(nA); expect(await flowSnap()).toBe(flows);
    // código já usado, e a sessão de A segue aguardando
    expect((await t.app.inject({ method: 'POST', url: `/v1/imports/leona/${s.body.code}`, payload: leona })).statusCode).toBe(410);
    expect((await t.prisma.flowImportSession.findUniqueOrThrow({ where: { code: aSession } })).status).toBe('WAITING');
  });

  it('importar por código de compartilhamento: cria um NOVO fluxo em B, sem dados/ids de A, e A intacto', async () => {
    const flows = await flowSnap();
    const r1 = await t.as(t.B, 'POST', '/v1/imports/nexo', { code: shareCode }); expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    const r2 = await t.as(t.B, 'POST', '/v1/imports/nexo', { code: shareCode }); expect(r2.status).toBe(201);
    expect(r2.body.playbookId).not.toBe(r1.body.playbookId);
    for (const id of [r1.body.playbookId, r2.body.playbookId]) {
      const pb = await t.prisma.playbook.findUniqueOrThrow({ where: { id }, include: { versions: true } });
      expect(pb.workspaceId).toBe(t.B.workspaceId); expect(pb.id).not.toBe(aFlow.id); expect(pb.status).toBe('DRAFT'); expect(pb.activeVersionId).toBeNull();
      const dump = JSON.stringify(pb);
      for (const secret of [aTag.id, aPixel.id, aTarget.id, a.board.id, a.column.id, t.A.workspaceId, t.A.userId, t.A.email]) expect(dump, `vazou ${secret}`).not.toContain(secret);
      expect(pb.versions[0]!.createdById).toBe(t.B.userId);
      // tags/quadro são recriados em B (por nome), nunca ligados aos ids de A
    }
    expect(JSON.stringify(r1.body.report)).not.toContain(aPixel.id);
    // o id do arquivo de A vem no conteúdo exportado, mas B não o lê e o relatório pede para reenviar
    expect(r1.body.report.items).toEqual(expect.arrayContaining([expect.objectContaining({ sourceType: 'asset', status: 'pending' })]));
    expect((await t.as(t.B, 'GET', `/v1/playbook-assets/${aAsset.id}`)).status).toBe(404);
    expect(await flowSnap()).toBe(flows);
    expect(await t.prisma.tag.count({ where: { workspaceId: t.B.workspaceId, name: 'tag-secreta-A' } })).toBe(1);
    expect(await t.prisma.tag.count({ where: { workspaceId: t.A.workspaceId, name: 'tag-secreta-A' } })).toBe(1);
  });

  it('códigos de compartilhamento inválidos/revogados: 410; revogado por A deixa de funcionar para B', async () => {
    expect((await t.as(t.B, 'POST', '/v1/imports/nexo', { code: 'ZZZZZZZZZZ' })).status).toBe(410);
    expect((await t.as(t.A, 'DELETE', `/v1/playbooks/${aFlow.id}/share-codes/${shareId}`)).status).toBe(204);
    expect((await t.as(t.B, 'POST', '/v1/imports/nexo', { code: shareCode })).status).toBe(410);
  });
});
