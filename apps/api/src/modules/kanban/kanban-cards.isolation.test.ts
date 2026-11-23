import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('isolamento entre workspaces: criar/remover cartão', () => {
  let t: TwoTenants; let a: Fixtures; let b: Fixtures;
  const state = async (f: Fixtures) => JSON.stringify(await t.prisma.kanbanCard.findMany({ where: { boardId: f.board.id }, orderBy: { id: 'asc' } }));
  beforeAll(async () => { t = await setupTwoTenants(); a = await t.fixtures(t.A); b = await t.fixtures(t.B); }, 60_000);
  afterAll(async () => { await t?.teardown(); });

  it('B não cria cartão em quadro de A (404) e A fica intacto', async () => {
    const before = await state(a);
    expect((await t.as(t.B, 'POST', `/v1/kanban/boards/${a.board.id}/cards`, { contactId: b.contact.id })).status).toBe(404);
    expect(await state(a)).toBe(before);
  });
  it('B não cria cartão com contato de A (404)', async () => {
    const before = await state(b);
    const r = await t.as(t.B, 'POST', `/v1/kanban/boards/${b.board.id}/cards`, { contactId: a.contact.id });
    expect(r.status).toBe(404);
    expect(await state(b)).toBe(before);
  });
  it('B não cria cartão em coluna de A (422) e não vaza o cartão existente de A', async () => {
    const before = await state(b);
    const r = await t.as(t.B, 'POST', `/v1/kanban/boards/${b.board.id}/cards`, { contactId: b.contact.id, columnId: a.column2.id });
    expect(r.status).toBe(422);
    expect(await state(b)).toBe(before);
    const dupA = await t.as(t.B, 'POST', `/v1/kanban/boards/${a.board.id}/cards`, { contactId: a.contact.id });
    expect(dupA.status).toBe(404);
    expect(JSON.stringify(dupA.body)).not.toContain(a.card.id);
  });
  it('B não apaga cartão de A (404) e A fica intacto', async () => {
    const before = await state(a);
    expect((await t.as(t.B, 'DELETE', `/v1/kanban/cards/${a.card.id}`)).status).toBe(404);
    expect(await state(a)).toBe(before);
  });
  it('B cria e remove o próprio cartão normalmente', async () => {
    const c = await t.prisma.contact.create({ data: { workspaceId: t.B.workspaceId, phone: '+5511970001111' } });
    const r = await t.as(t.B, 'POST', `/v1/kanban/boards/${b.board.id}/cards`, { contactId: c.id, columnId: b.column2.id });
    expect(r.status).toBe(201);
    expect((await t.as(t.B, 'DELETE', `/v1/kanban/cards/${r.body.id}`)).status).toBe(204);
  });
});
