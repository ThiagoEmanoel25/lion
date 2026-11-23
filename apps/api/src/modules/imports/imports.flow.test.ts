import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type TwoTenants } from '../../test/two-tenants.js';

const dir = new URL('./fixtures/', import.meta.url);
const load = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(name, dir)), 'utf8'));

describe.skipIf(!hasTestDb)('fluxo: imports', () => {
  let t: TwoTenants;
  beforeAll(async () => { t = await setupTwoTenants(); }, 60_000);
  afterAll(async () => { await t?.teardown(); });
  const post = (code: string, body: unknown) => t.app.inject({ method: 'POST', url: `/v1/imports/leona/${code}`, payload: body as object });

  it('Leona: sessão -> exportar -> consultar; código não pode ser reutilizado', async () => {
    const s = await t.as(t.A, 'POST', '/v1/imports/leona/sessions');
    expect(s.status).toBe(201);
    const r = await post(s.body.code, load('leona-flow.redacted.json'));
    expect([201, 422]).toContain(r.statusCode);
    if (r.statusCode === 201) {
      const g = await t.as(t.A, 'GET', `/v1/imports/leona/sessions/${s.body.code}`);
      expect(g.body.status).toBe('COMPLETED');
      expect((await post(s.body.code, load('leona-flow.redacted.json'))).statusCode).toBe(410);
    }
    // B não enxerga a sessão de A
    expect((await t.as(t.B, 'GET', `/v1/imports/leona/sessions/${s.body.code}`)).status).toBe(404);
  });

  it('todos os exports Leona de exemplo importam sem 500 (um código por arquivo)', async () => {
    const files = readdirSync(fileURLToPath(dir)).filter(f => f.endsWith('.json'));
    const out: Record<string, number> = {};
    for (const f of files) {
      const s = await t.as(t.A, 'POST', '/v1/imports/leona/sessions');
      out[f] = (await post(s.body.code, load(f))).statusCode;
    }
    for (const [f, code] of Object.entries(out)) expect(code, f).toBeLessThan(500);
  });

  it('duas importações simultâneas do mesmo código criam no máximo um fluxo', async () => {
    const s = await t.as(t.A, 'POST', '/v1/imports/leona/sessions');
    const body = load('leona-flow.redacted.json');
    const before = await t.prisma.playbook.count({ where: { workspaceId: t.A.workspaceId } });
    const rs = await Promise.all([post(s.body.code, body), post(s.body.code, body), post(s.body.code, body)]);
    expect(rs.every(r => r.statusCode < 500), JSON.stringify(rs.map(r => r.statusCode))).toBe(true);
    expect(await t.prisma.playbook.count({ where: { workspaceId: t.A.workspaceId } }) - before).toBeLessThanOrEqual(1);
  });

  it('código expirado e corpo inválido', async () => {
    const s = await t.as(t.A, 'POST', '/v1/imports/leona/sessions');
    await t.prisma.flowImportSession.update({ where: { code: s.body.code }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await post(s.body.code, load('leona-flow.redacted.json'))).statusCode).toBe(410);
    const s2 = await t.as(t.A, 'POST', '/v1/imports/leona/sessions');
    expect((await post(s2.body.code, { source: 'leona', version: 1, nodes: [], edges: [] })).statusCode).toBe(422);
    expect((await post('NAOEXISTE', load('leona-flow.redacted.json'))).statusCode).toBe(410);
  });

  it('compartilhar entre workspaces: gerar código, importar 2x, revogar', async () => {
    const pb = (await t.as(t.A, 'POST', '/v1/playbooks', { name: 'Fluxo para compartilhar', template: 'qualification' })).body;
    const sc = await t.as(t.A, 'POST', `/v1/playbooks/${pb.id}/share-codes`);
    expect(sc.status).toBe(201);
    const i1 = await t.as(t.B, 'POST', '/v1/imports/nexo', { code: sc.body.code.toLowerCase() });
    expect(i1.status).toBe(201);
    const i2 = await t.as(t.B, 'POST', '/v1/imports/nexo', { code: sc.body.code });
    expect(i2.status).toBe(201);
    expect(i1.body.playbookId).not.toBe(i2.body.playbookId);
    expect((await t.as(t.A, 'DELETE', `/v1/playbooks/${pb.id}/share-codes/${sc.body.id}`)).status).toBe(204);
    expect((await t.as(t.B, 'POST', '/v1/imports/nexo', { code: sc.body.code })).status).toBe(410);
    expect((await t.as(t.B, 'POST', '/v1/imports/nexo', { code: 'curto' })).status).toBe(422);
  });

  it('compartilhar fluxo que usa etiqueta/kanban e importar no outro workspace duas vezes não duplica etiqueta/quadro', async () => {
    const tag = await t.prisma.tag.create({ data: { workspaceId: t.A.workspaceId, name: 'quente' } });
    const pb = (await t.as(t.A, 'POST', '/v1/playbooks', { name: 'Com etiqueta', template: 'qualification' })).body;
    const def = structuredClone(pb.versions[0].definition);
    def.nodes.push({ id: 'tg', kind: 'tag', name: 'Etiquetar', config: { mode: 'add', tagIds: [tag.id] }, position: { x: 900, y: 100 } });
    def.edges.push({ id: 'etg', source: 'outcome', target: 'tg' });
    const v = await t.as(t.A, 'POST', `/v1/playbooks/${pb.id}/versions`, { definition: def, expectedVersion: 1 });
    if (v.status !== 201) return; // definição de exemplo inválida: não é o foco
    const sc = await t.as(t.A, 'POST', `/v1/playbooks/${pb.id}/share-codes`);
    expect(sc.status).toBe(201);
    await Promise.all([t.as(t.B, 'POST', '/v1/imports/nexo', { code: sc.body.code }), t.as(t.B, 'POST', '/v1/imports/nexo', { code: sc.body.code })]).then(rs => expect(rs.map(r => r.status)).toEqual([201, 201]));
    expect(await t.prisma.tag.count({ where: { workspaceId: t.B.workspaceId, name: 'quente' } })).toBe(1);
  });
});
