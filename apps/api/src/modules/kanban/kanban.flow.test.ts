import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('fluxo: kanban', () => {
  let t: TwoTenants;
  beforeAll(async () => { t = await setupTwoTenants(); }, 60_000);
  afterAll(async () => { await t?.teardown(); });

  const mkCard = async (boardId: string, columnId: string, position: number) => {
    const c = await t.prisma.contact.create({ data: { workspaceId: t.A.workspaceId, phone: `+5511${Math.floor(Math.random() * 1e9)}` } });
    return t.prisma.kanbanCard.create({ data: { boardId, columnId, contactId: c.id, position, movedByType: 'user', movedById: t.A.userId } });
  };

  it('H2-22: colunas criadas depois de excluir uma do meio não repetem posição', async () => {
    const b = (await t.as(t.A, 'POST', '/v1/kanban/boards', { name: 'Funil' })).body;
    const cols: any[] = [];
    for (const n of ['A', 'B', 'C']) cols.push((await t.as(t.A, 'POST', `/v1/kanban/boards/${b.id}/columns`, { name: n })).body);
    expect((await t.as(t.A, 'DELETE', `/v1/kanban/columns/${cols[0].id}`, {})).status).toBe(200);
    const d = (await t.as(t.A, 'POST', `/v1/kanban/boards/${b.id}/columns`, { name: 'D' })).body;
    const all = await t.prisma.kanbanColumn.findMany({ where: { boardId: b.id } });
    expect(new Set(all.map(c => c.position)).size).toBe(all.length);
    expect(d.name).toBe('D');
  });

  it('H2-23: criar quadros em paralelo / após excluir não repete posição de quadro', async () => {
    const mk = (n: string) => t.as(t.A, 'POST', '/v1/kanban/boards', { name: n });
    const [x, y] = await Promise.all([mk('P1'), mk('P2')]);
    expect([x.status, y.status]).toEqual([201, 201]);
    const boards = await t.prisma.kanbanBoard.findMany({ where: { workspaceId: t.A.workspaceId } });
    expect(new Set(boards.map(b => b.position)).size).toBe(boards.length);
  });

  it('caminho feliz: mover cards, reposicionar, excluir coluna com destino, excluir quadro', async () => {
    const b = (await t.as(t.A, 'POST', '/v1/kanban/boards', { name: 'Vendas' })).body;
    const c1 = (await t.as(t.A, 'POST', `/v1/kanban/boards/${b.id}/columns`, { name: 'Novo' })).body;
    const c2 = (await t.as(t.A, 'POST', `/v1/kanban/boards/${b.id}/columns`, { name: 'Ganho' })).body;
    expect((await t.as(t.A, 'POST', `/v1/kanban/boards`, { name: 'Vendas' })).status).toBe(409);
    expect((await t.as(t.A, 'POST', `/v1/kanban/boards/${b.id}/columns`, { name: 'Novo' })).status).toBe(409);
    const cards = [await mkCard(b.id, c1.id, 0), await mkCard(b.id, c1.id, 1), await mkCard(b.id, c1.id, 2)];
    expect((await t.as(t.A, 'PATCH', `/v1/kanban/cards/${cards[0]!.id}/move`, { columnId: c2.id })).status).toBe(200);
    expect((await t.as(t.A, 'PATCH', `/v1/kanban/cards/${cards[2]!.id}/move`, { columnId: c1.id, position: 0 })).status).toBe(200);
    const left = await t.prisma.kanbanCard.findMany({ where: { columnId: c1.id }, orderBy: { position: 'asc' } });
    expect(left.map(c => c.id)).toEqual([cards[2]!.id, cards[1]!.id]);
    expect(left.map(c => c.position)).toEqual([0, 1]);
    expect((await t.as(t.A, 'PATCH', `/v1/kanban/cards/${cards[1]!.id}/move`, { columnId: c2.id, position: 999 })).status).toBeLessThan(500);
    expect((await t.as(t.A, 'PATCH', `/v1/kanban/cards/${cards[1]!.id}/move`, { columnId: c2.id, position: -3 })).status).toBeLessThan(500);
    expect((await t.as(t.A, 'DELETE', `/v1/kanban/columns/${c2.id}`, {})).status).toBe(422);
    const del = await t.as(t.A, 'DELETE', `/v1/kanban/columns/${c2.id}`, { destinationColumnId: c1.id });
    expect(del.status).toBe(200);
    expect(await t.prisma.kanbanCard.count({ where: { columnId: c1.id } })).toBe(3);
    expect((await t.as(t.A, 'DELETE', `/v1/kanban/boards/${b.id}`)).status).toBe(204);
    expect((await t.as(t.A, 'DELETE', `/v1/kanban/boards/${b.id}`)).status).toBe(404);
  });

  it('H2-24: excluir coluna/quadro usado por fluxo publicado deve avisar (409), não quebrar o fluxo em silêncio', async () => {
    const b = (await t.as(t.A, 'POST', '/v1/kanban/boards', { name: 'Usado' })).body;
    const c = (await t.as(t.A, 'POST', `/v1/kanban/boards/${b.id}/columns`, { name: 'Col' })).body;
    const pb = await t.prisma.playbook.create({ data: { workspaceId: t.A.workspaceId, name: 'Usa kanban', status: 'PUBLISHED' } });
    const v = await t.prisma.playbookVersion.create({ data: { playbookId: pb.id, version: 1, checksum: 'k1', publishedAt: new Date(), createdById: t.A.userId, definition: { nodes: [{ id: 'n1', kind: 'kanban', config: { boardId: b.id, columnId: c.id, mode: 'create_or_move' } }], edges: [] } } });
    await t.prisma.playbook.update({ where: { id: pb.id }, data: { activeVersionId: v.id } });
    const r = await t.as(t.A, 'DELETE', `/v1/kanban/columns/${c.id}`, {});
    expect(r.status).toBe(409);
  });
});
