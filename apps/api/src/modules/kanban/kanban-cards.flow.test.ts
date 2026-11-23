import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('fluxo: cartões do kanban (criar/remover)', () => {
  let t: TwoTenants;
  beforeAll(async () => { t = await setupTwoTenants(); }, 60_000);
  afterAll(async () => { await t?.teardown(); });
  const contact = async (n: number) => (await t.prisma.contact.create({ data: { workspaceId: t.A.workspaceId, phone: `+551198800${String(n).padStart(4, '0')}` } })).id;

  it('cria na primeira coluna, posição no fim, evento e auditoria; duplicado 409 com o id existente', async () => {
    const b = (await t.as(t.A, 'POST', '/v1/kanban/boards', { name: 'Cartões' })).body;
    const c1 = (await t.as(t.A, 'POST', `/v1/kanban/boards/${b.id}/columns`, { name: 'Novo' })).body;
    const c2 = (await t.as(t.A, 'POST', `/v1/kanban/boards/${b.id}/columns`, { name: 'Ganho' })).body;
    const [x, y, z] = [await contact(1), await contact(2), await contact(3)];
    const r1 = await t.as(t.A, 'POST', `/v1/kanban/boards/${b.id}/cards`, { contactId: x, title: 'Lead X', note: 'ligar amanhã' });
    expect(r1.status).toBe(201);
    expect(r1.body).toMatchObject({ columnId: c1.id, position: 0, title: 'Lead X', note: 'ligar amanhã', contactId: x });
    const r2 = await t.as(t.A, 'POST', `/v1/kanban/boards/${b.id}/cards`, { contactId: y });
    expect(r2.body).toMatchObject({ columnId: c1.id, position: 1 });
    const r3 = await t.as(t.A, 'POST', `/v1/kanban/boards/${b.id}/cards`, { contactId: z, columnId: c2.id });
    expect(r3.body).toMatchObject({ columnId: c2.id, position: 0 });
    expect(await t.prisma.kanbanCardEvent.count({ where: { cardId: r1.body.id, toColumnId: c1.id, fromColumnId: null } })).toBe(1);
    expect(await t.prisma.auditLog.count({ where: { targetId: r1.body.id, action: 'kanban.card_created' } })).toBe(1);
    const dup = await t.as(t.A, 'POST', `/v1/kanban/boards/${b.id}/cards`, { contactId: x, columnId: c2.id });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('KANBAN_CARD_EXISTS');
    expect(JSON.stringify(dup.body)).toContain(r1.body.id);
    expect(await t.prisma.kanbanCard.count({ where: { boardId: b.id } })).toBe(3);
    // aparece no GET do quadro
    const list = (await t.as(t.A, 'GET', '/v1/kanban/boards')).body.find((x: any) => x.id === b.id);
    expect(list.columns[0].cards.map((c: any) => c.id)).toEqual([r1.body.id, r2.body.id]);
    // remove: fecha o buraco de posições
    expect((await t.as(t.A, 'DELETE', `/v1/kanban/cards/${r1.body.id}`)).status).toBe(204);
    expect((await t.prisma.kanbanCard.findUnique({ where: { id: r2.body.id } }))?.position).toBe(0);
    expect((await t.as(t.A, 'DELETE', `/v1/kanban/cards/${r1.body.id}`)).status).toBe(404);
    expect(await t.prisma.auditLog.count({ where: { targetId: r1.body.id, action: 'kanban.card_deleted' } })).toBe(1);
    // pode recriar depois de remover
    expect((await t.as(t.A, 'POST', `/v1/kanban/boards/${b.id}/cards`, { contactId: x })).status).toBe(201);
  });

  it('quadro sem coluna: 422; coluna de outro quadro: 422; contato inexistente: 404', async () => {
    const empty = (await t.as(t.A, 'POST', '/v1/kanban/boards', { name: 'Vazio' })).body;
    const other = (await t.as(t.A, 'POST', '/v1/kanban/boards', { name: 'Outro' })).body;
    const oc = (await t.as(t.A, 'POST', `/v1/kanban/boards/${other.id}/columns`, { name: 'C' })).body;
    const c = await contact(10);
    expect((await t.as(t.A, 'POST', `/v1/kanban/boards/${empty.id}/cards`, { contactId: c })).status).toBe(422);
    expect((await t.as(t.A, 'POST', `/v1/kanban/boards/${empty.id}/cards`, { contactId: c, columnId: oc.id })).status).toBe(422);
    expect((await t.as(t.A, 'POST', `/v1/kanban/boards/${other.id}/cards`, { contactId: 'naoexiste' })).status).toBe(404);
  });

  it('duas criações simultâneas do mesmo contato: uma 201 e uma 409', async () => {
    const b = (await t.as(t.A, 'POST', '/v1/kanban/boards', { name: 'Corrida' })).body;
    await t.as(t.A, 'POST', `/v1/kanban/boards/${b.id}/columns`, { name: 'C' });
    const c = await contact(11);
    const rs = await Promise.all([1, 2].map(() => t.as(t.A, 'POST', `/v1/kanban/boards/${b.id}/cards`, { contactId: c })));
    expect(rs.map(r => r.status).sort()).toEqual([201, 409]);
  });
});
