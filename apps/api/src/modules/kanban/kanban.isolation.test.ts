import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';
import { applyKanbanCardAction } from './service.js';

describe.skipIf(!hasTestDb)('isolamento entre workspaces: kanban', () => {
  let t: TwoTenants; let a: Fixtures; let b: Fixtures;
  const state = async (f: Fixtures) => JSON.stringify({
    board: await t.prisma.kanbanBoard.findUnique({ where: { id: f.board.id } }),
    cols: await t.prisma.kanbanColumn.findMany({ where: { boardId: f.board.id }, orderBy: { id: 'asc' } }),
    cards: await t.prisma.kanbanCard.findMany({ where: { boardId: f.board.id }, orderBy: { id: 'asc' } }),
  });
  beforeAll(async () => { t = await setupTwoTenants(); a = await t.fixtures(t.A); b = await t.fixtures(t.B); }, 60_000);
  afterAll(async () => { await t?.teardown(); });

  it('GET /v1/kanban/boards: B só vê o quadro de B', async () => {
    const r = await t.as(t.B, 'GET', '/v1/kanban/boards');
    expect(r.status).toBe(200);
    expect(r.body.map((x: any) => x.id)).toEqual([b.board.id]);
    expect(JSON.stringify(r.body)).not.toContain(a.card.id);
  });
  it('PATCH /boards/:boardId: 404 e quadro de A intacto', async () => {
    const before = await state(a);
    expect((await t.as(t.B, 'PATCH', `/v1/kanban/boards/${a.board.id}`, { name: 'Invadido' })).status).toBe(404);
    expect(await state(a)).toBe(before);
  });
  it('DELETE /boards/:boardId: 404 e quadro/cards de A intactos', async () => {
    const before = await state(a);
    expect((await t.as(t.B, 'DELETE', `/v1/kanban/boards/${a.board.id}`)).status).toBe(404);
    expect(await state(a)).toBe(before);
  });
  it('POST /boards/:boardId/columns: 404 e nenhuma coluna criada em A', async () => {
    const before = await state(a);
    expect((await t.as(t.B, 'POST', `/v1/kanban/boards/${a.board.id}/columns`, { name: 'Nova' })).status).toBe(404);
    expect(await state(a)).toBe(before);
  });
  it('PATCH /columns/:columnId: 404 e coluna de A intacta', async () => {
    const before = await state(a);
    expect((await t.as(t.B, 'PATCH', `/v1/kanban/columns/${a.column.id}`, { name: 'Invadida' })).status).toBe(404);
    expect(await state(a)).toBe(before);
  });
  it('DELETE /columns/:columnId: 404 (com e sem destino) e A intacto', async () => {
    const before = await state(a);
    expect((await t.as(t.B, 'DELETE', `/v1/kanban/columns/${a.column.id}`)).status).toBe(404);
    expect((await t.as(t.B, 'DELETE', `/v1/kanban/columns/${a.column.id}`, { destinationColumnId: b.column2.id })).status).toBe(404);
    expect(await state(a)).toBe(before);
  });
  it('PATCH /cards/:cardId/move: 404 e card de A intacto', async () => {
    const before = await state(a);
    expect((await t.as(t.B, 'PATCH', `/v1/kanban/cards/${a.card.id}/move`, { columnId: a.column2.id })).status).toBe(404);
    expect((await t.as(t.B, 'PATCH', `/v1/kanban/cards/${a.card.id}/move`, { columnId: b.column2.id })).status).toBe(404);
    expect(await state(a)).toBe(before);
  });
  it('mover card de B para coluna de A: 422 e B intacto', async () => {
    const before = await state(b);
    expect((await t.as(t.B, 'PATCH', `/v1/kanban/cards/${b.card.id}/move`, { columnId: a.column2.id })).status).toBe(422);
    expect(await state(b)).toBe(before);
  });
  it('excluir coluna de B com destinationColumnId de A: 422, B e A intactos', async () => {
    const [sb, sa] = [await state(b), await state(a)];
    const r = await t.as(t.B, 'DELETE', `/v1/kanban/columns/${b.column.id}`, { destinationColumnId: a.column2.id });
    expect(r.status).toBe(422);
    expect(await state(b)).toBe(sb); expect(await state(a)).toBe(sa);
  });
  it('applyKanbanCardAction (serviço): board/coluna/contato/conversa de A são recusados para B', async () => {
    const base = { workspaceId: t.B.workspaceId, mode: 'MOVE' as any, actor: { type: 'user' as const, id: t.B.userId } };
    const sa = await state(a);
    await expect(applyKanbanCardAction(t.prisma, { ...base, boardId: a.board.id, columnId: a.column.id, contactId: b.contact.id })).rejects.toThrow();
    await expect(applyKanbanCardAction(t.prisma, { ...base, boardId: b.board.id, columnId: b.column.id, contactId: a.contact.id })).rejects.toThrow();
    await expect(applyKanbanCardAction(t.prisma, { ...base, boardId: b.board.id, columnId: b.column.id, contactId: b.contact.id, conversationId: a.conversation.id })).rejects.toThrow();
    expect(await state(a)).toBe(sa);
  });
});
