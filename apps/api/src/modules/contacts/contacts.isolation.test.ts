import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('isolamento entre workspaces: contacts', () => {
  let t: TwoTenants; let a: Fixtures; let b: Fixtures;
  const snap = async () => JSON.stringify(await t.prisma.contact.findUnique({ where: { id: a.contact.id }, include: { tags: true } }));
  beforeAll(async () => { t = await setupTwoTenants(); a = await t.fixtures(t.A); b = await t.fixtures(t.B); await t.prisma.contactTag.create({ data: { contactId: a.contact.id, tagId: a.tag.id } }); }, 60_000);
  afterAll(async () => { await t?.teardown(); });

  it('GET /v1/contacts: B não vê contatos de A (nem por busca, owner ou tag)', async () => {
    for (const qs of ['', `?search=${encodeURIComponent(a.contact.name!)}`, `?ownerId=${t.A.userId}`, `?tagId=${a.tag.id}`, `?stage=new`]) {
      const r = await t.as(t.B, 'GET', `/v1/contacts${qs}`);
      expect(r.status).toBe(200);
      expect(r.body.items.map((c: any) => c.id)).not.toContain(a.contact.id);
    }
    expect((await t.as(t.B, 'GET', '/v1/contacts')).body.items.map((c: any) => c.id)).toContain(b.contact.id);
  });
  it('GET /v1/contacts/meta: sem tags, membros ou contagens de A', async () => {
    const r = await t.as(t.B, 'GET', '/v1/contacts/meta');
    expect(r.status).toBe(200);
    expect(r.body.tags.map((x: any) => x.id)).not.toContain(a.tag.id);
    expect(r.body.members.map((x: any) => x.id)).not.toContain(t.A.userId);
    expect(r.body.stageCounts.reduce((n: number, s: any) => n + s.count, 0)).toBe(1);
  });
  it('GET /v1/contacts/:id: 404', async () => {
    expect((await t.as(t.B, 'GET', `/v1/contacts/${a.contact.id}`)).status).toBe(404);
  });
  it('PATCH /v1/contacts/:id: 404 e contato de A intacto', async () => {
    const before = await snap();
    const r = await t.as(t.B, 'PATCH', `/v1/contacts/${a.contact.id}`, { name: 'Invadido', stage: 'won', tagIds: [], ownerId: null });
    expect(r.status).toBe(404);
    expect(await snap()).toBe(before);
  });
  it('POST /v1/contacts com ownerId/tagIds de A: 422 e nada criado', async () => {
    const n = await t.prisma.contact.count({ where: { workspaceId: t.B.workspaceId } });
    expect((await t.as(t.B, 'POST', '/v1/contacts', { name: 'X', phone: '5511988887777', ownerId: t.A.userId })).status).toBe(422);
    expect((await t.as(t.B, 'POST', '/v1/contacts', { name: 'X', phone: '5511988887777', tagIds: [a.tag.id] })).status).toBe(422);
    expect(await t.prisma.contact.count({ where: { workspaceId: t.B.workspaceId } })).toBe(n);
  });
  it('PATCH de contato próprio com ownerId/tagIds de A: 422 e contato de B intacto', async () => {
    const before = JSON.stringify(await t.prisma.contact.findUnique({ where: { id: b.contact.id }, include: { tags: true } }));
    expect((await t.as(t.B, 'PATCH', `/v1/contacts/${b.contact.id}`, { ownerId: t.A.userId })).status).toBe(422);
    expect((await t.as(t.B, 'PATCH', `/v1/contacts/${b.contact.id}`, { tagIds: [a.tag.id] })).status).toBe(422);
    expect(JSON.stringify(await t.prisma.contact.findUnique({ where: { id: b.contact.id }, include: { tags: true } }))).toBe(before);
  });
  it('POST /v1/contacts/import com telefone de A: cria em B e não altera A', async () => {
    const before = await snap();
    const r = await t.as(t.B, 'POST', '/v1/contacts/import', { csv: `nome,telefone,etiquetas\nSobrescrito,${a.contact.phone},vip`, updateExisting: true });
    expect(r.status).toBe(200); expect(r.body.created).toBe(1);
    expect(await snap()).toBe(before);
    expect(await t.prisma.contact.count({ where: { workspaceId: t.A.workspaceId, name: 'Sobrescrito' } })).toBe(0);
  });
  it('POST /v1/contact-tags: tag criada pertence a B', async () => {
    const r = await t.as(t.B, 'POST', '/v1/contact-tags', { name: `b-${Date.now()}` });
    expect(r.status).toBe(201);
    expect(r.body.workspaceId).toBe(t.B.workspaceId);
  });
});
