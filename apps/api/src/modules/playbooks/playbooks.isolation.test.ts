import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';

const base = { start: 'start', nodes: [
  { id: 'start', kind: 'trigger', name: 'Início', config: {}, position: { x: 0, y: 0 } },
  { id: 'done', kind: 'outcome', name: 'Fim', config: { type: 'RESOLVED' }, position: { x: 200, y: 0 } }
], edges: [{ id: 'e1', source: 'start', target: 'done' }], settings: { maxSteps: 10, timeoutSeconds: 60 } };
const withNode = (node: Record<string, unknown>) => ({ ...base, nodes: [base.nodes[0], { id: 'n', name: 'N', position: { x: 100, y: 0 }, ...node }, base.nodes[1]], edges: [{ id: 'e1', source: 'start', target: 'n' }, { id: 'e2', source: 'n', target: 'done' }] });

describe.skipIf(!hasTestDb)('isolamento entre workspaces: playbooks', () => {
  let t: TwoTenants; let a: Fixtures; let b: Fixtures;
  let aFolder: { id: string; name: string }; let aExec: { id: string }; let aSim: string; let bPlaybookId: string; let bConv: string;
  const pbSnap = async () => JSON.stringify([await t.prisma.playbook.findUnique({ where: { id: a.playbook.id } }), await t.prisma.playbookVersion.findMany({ where: { playbookId: a.playbook.id }, orderBy: { version: 'asc' } })]);
  const execSnap = async () => JSON.stringify(await t.prisma.execution.findUnique({ where: { id: aExec.id } }));
  const as = (m: any, u: string, body?: unknown) => t.as(t.B, m, u, body);

  beforeAll(async () => {
    t = await setupTwoTenants(); a = await t.fixtures(t.A); b = await t.fixtures(t.B);
    aFolder = await t.prisma.playbookFolder.create({ data: { workspaceId: t.A.workspaceId, name: `pasta-a-${Date.now()}`, position: 0 } });
    await t.prisma.playbook.update({ where: { id: a.playbook.id }, data: { folderId: aFolder.id } });
    aExec = await t.prisma.execution.create({ data: { workspaceId: t.A.workspaceId, conversationId: a.conversation.id, playbookVersionId: (await t.prisma.playbook.findUniqueOrThrow({ where: { id: a.playbook.id } })).activeVersionId!, status: 'RUNNING' } });
    await t.prisma.flowDistributorCount.create({ data: { playbookId: a.playbook.id, nodeId: 'd', outputId: 'o', count: 7 } });
    bPlaybookId = b.playbook.id; bConv = b.conversation.id;
    const s = await t.as(t.A, 'POST', `/v1/playbooks/${a.playbook.id}/simulation-sessions`, { definition: base });
    expect(s.status).toBe(201); aSim = s.body.simulationId;
  }, 60_000);
  afterAll(async () => { await t?.teardown(); });

  it('GET /v1/playbooks e /v1/playbook-folders: sem itens de A', async () => {
    const l = await as('GET', '/v1/playbooks'); expect(l.status).toBe(200);
    expect(l.body.map((p: any) => p.id)).not.toContain(a.playbook.id); expect(l.body.map((p: any) => p.id)).toContain(b.playbook.id);
    const f = await as('GET', '/v1/playbook-folders'); expect(f.status).toBe(200);
    expect(f.body.map((x: any) => x.id)).not.toContain(aFolder.id);
  });

  it('rotas de leitura com :id de A: 404', async () => {
    const id = a.playbook.id;
    for (const u of [`/v1/playbooks/${id}`, `/v1/playbooks/${id}/archive-impact`, `/v1/playbooks/${id}/distributors`, `/v1/playbooks/${id}/executions`, `/v1/executions/${aExec.id}`]) {
      const r = await as('GET', u); expect(r.status, u).toBe(404);
    }
  });

  it('ações de escrita com :id de A: 404 e fluxo/versões/execução de A intactos', async () => {
    const before = await pbSnap(); const eb = await execSnap(); const id = a.playbook.id;
    const calls: Array<[string, string, unknown?]> = [
      ['POST', `/v1/playbooks/${id}/versions`, { expectedVersion: 1, definition: base }],
      ['POST', `/v1/playbooks/${id}/validate`, { definition: base }],
      ['POST', `/v1/playbooks/${id}/simulate`, { definition: base }],
      ['POST', `/v1/playbooks/${id}/simulate`, { version: 1 }],
      ['POST', `/v1/playbooks/${id}/integration/test`, { config: { url: 'https://example.com', method: 'GET' } }],
      ['POST', `/v1/playbooks/${id}/publish`, { expectedVersion: 1 }],
      ['POST', `/v1/playbooks/${id}/pause`],
      ['POST', `/v1/playbooks/${id}/resume`],
      ['POST', `/v1/playbooks/${id}/archive`, { confirmDetach: true }],
      ['POST', `/v1/playbooks/${id}/unarchive`],
      ['PATCH', `/v1/playbooks/${id}/folder`, { folderId: null }],
      ['POST', `/v1/playbooks/${id}/executions`, { conversationId: b.conversation.id }],
      ['POST', `/v1/playbooks/${id}/executions`, { conversationId: a.conversation.id }],
      ['POST', `/v1/executions/${aExec.id}/cancel`]
    ];
    for (const [m, u, body] of calls) { const r = await as(m, u, body ?? {}); expect(r.status, `${m} ${u}`).toBe(404); }
    expect(await pbSnap()).toBe(before); expect(await execSnap()).toBe(eb);
    expect(await t.prisma.execution.count({ where: { playbookVersion: { playbookId: id } } })).toBe(1);
  });

  it('pastas de A: PATCH/DELETE 404 e pasta de A intacta', async () => {
    expect((await as('PATCH', `/v1/playbook-folders/${aFolder.id}`, { name: 'Invadida' })).status).toBe(404);
    expect((await as('DELETE', `/v1/playbook-folders/${aFolder.id}`)).status).toBe(404);
    const f = await t.prisma.playbookFolder.findUnique({ where: { id: aFolder.id } });
    expect(f?.name).toBe(aFolder.name);
    expect((await t.prisma.playbook.findUnique({ where: { id: a.playbook.id } }))?.folderId).toBe(aFolder.id);
  });

  it('PATCH /v1/playbooks/:id/folder de B com folderId de A: 404 e fluxo de B sem pasta', async () => {
    expect((await as('PATCH', `/v1/playbooks/${bPlaybookId}/folder`, { folderId: aFolder.id })).status).toBe(404);
    expect((await t.prisma.playbook.findUnique({ where: { id: bPlaybookId } }))?.folderId).toBeNull();
  });

  it('POST execução em fluxo de B com conversationId de A: 404 e nada criado', async () => {
    const r = await as('POST', `/v1/playbooks/${bPlaybookId}/executions`, { conversationId: a.conversation.id });
    expect(r.status).toBe(404);
    expect(await t.prisma.execution.count({ where: { conversationId: a.conversation.id } })).toBe(1);
  });

  it('versão em fluxo de B com referências de A (flow_jump, pixel, kanban): 422 e nada salvo', async () => {
    const apx = await t.prisma.metaPixel.create({ data: { workspaceId: t.A.workspaceId, name: 'px-a', pixelId: '1234567', accessTokenEncrypted: 'x', accessTokenLast4: 'xxxx' } });
    const cases = [
      withNode({ kind: 'flow_jump', config: { targetPlaybookId: a.playbook.id } }),
      withNode({ kind: 'pixel', config: { pixelId: apx.id, eventName: 'ViewContent' } }),
      withNode({ kind: 'kanban', config: { boardId: a.board.id, columnId: a.column.id, mode: 'create_or_move' } })
    ];
    const before = await t.prisma.playbookVersion.count({ where: { playbookId: bPlaybookId } });
    for (const definition of cases) {
      const r = await as('POST', `/v1/playbooks/${bPlaybookId}/versions`, { expectedVersion: before, definition });
      expect(r.status, JSON.stringify(r.body)).toBe(422);
      const v = await as('POST', `/v1/playbooks/${bPlaybookId}/validate`, { definition }); expect(v.body.valid).toBe(false);
    }
    expect(await t.prisma.playbookVersion.count({ where: { playbookId: bPlaybookId } })).toBe(before);
  });

  it('versão em fluxo de B com nexo-asset:// de A: recusada (422) e nada salvo', async () => {
    const asset = await t.prisma.playbookAsset.create({ data: { workspaceId: t.A.workspaceId, fileName: 'a.png', contentType: 'image/png', size: 3, data: Buffer.from([1, 2, 3]) } });
    const definition = withNode({ kind: 'image', config: { url: `nexo-asset://${asset.id}` } });
    const before = await t.prisma.playbookVersion.count({ where: { playbookId: bPlaybookId } });
    const r = await as('POST', `/v1/playbooks/${bPlaybookId}/versions`, { expectedVersion: before, definition });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(await t.prisma.playbookVersion.count({ where: { playbookId: bPlaybookId } })).toBe(before);
    const own = await t.prisma.playbookAsset.create({ data: { workspaceId: t.B.workspaceId, fileName: 'b.png', contentType: 'image/png', size: 3, data: Buffer.from([1, 2, 3]) } });
    const ok = await as('POST', `/v1/playbooks/${bPlaybookId}/versions`, { expectedVersion: before, definition: withNode({ kind: 'image', config: { url: `nexo-asset://${own.id}` } }) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });

  it('simulação com nexo-asset:// de A ou flow_jump para A: recusada', async () => {
    const asset = await t.prisma.playbookAsset.findFirstOrThrow({ where: { workspaceId: t.A.workspaceId } });
    expect((await as('POST', `/v1/playbooks/${bPlaybookId}/simulate`, { definition: withNode({ kind: 'image', config: { url: `nexo-asset://${asset.id}` } }) })).status).toBe(422);
    expect((await as('POST', `/v1/playbooks/${bPlaybookId}/simulate`, { definition: withNode({ kind: 'flow_jump', config: { targetPlaybookId: a.playbook.id } }) })).status).toBe(422);
  });

  it('sessões de simulação de A: B recebe 404 por qualquer rota (inclusive com seu próprio :id)', async () => {
    for (const pid of [a.playbook.id, bPlaybookId]) {
      const u = `/v1/playbooks/${pid}/simulation-sessions`;
      expect((await as('POST', u, { definition: base })).status).toBe(pid === a.playbook.id ? 404 : 201);
      for (const [m, p, body] of [['POST', `${u}/${aSim}/messages`, { text: 'oi' }], ['POST', `${u}/${aSim}/advance`, {}], ['POST', `${u}/${aSim}/restart`, {}], ['DELETE', `${u}/${aSim}`, undefined]] as const) {
        const r = await as(m, p, body); expect(r.status, `${m} ${p}`).toBe(404);
      }
    }
    expect((await t.as(t.A, 'POST', `/v1/playbooks/${a.playbook.id}/simulation-sessions/${aSim}/advance`, {})).status).toBe(200);
  });
});
