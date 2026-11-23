import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('isolamento entre workspaces: consentimento do contato', () => {
  let t: TwoTenants; let a: Fixtures; let b: Fixtures;
  const snap = async (id: string) => JSON.stringify(await t.prisma.contact.findUnique({ where: { id } }));
  beforeAll(async () => { t = await setupTwoTenants(); a = await t.fixtures(t.A); b = await t.fixtures(t.B); }, 60_000);
  afterAll(async () => { await t?.teardown(); });

  it('PATCH /contacts/:id com consent: 404 e contato de A intacto', async () => {
    const before = await snap(a.contact.id);
    expect((await t.as(t.B, 'PATCH', `/v1/contacts/${a.contact.id}`, { consent: { given: true, source: 'manual' } })).status).toBe(404);
    expect(await snap(a.contact.id)).toBe(before);
  });
  it('POST /contacts/consent em lote: ids de A são ignorados (notFound) e A fica intacto; ids de B são atualizados', async () => {
    const before = await snap(a.contact.id);
    const r = await t.as(t.B, 'POST', '/v1/contacts/consent', { contactIds: [a.contact.id, b.contact.id], given: true, source: 'manual' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ updated: 1, ignored: 1, ignoredReasons: { notFound: 1 } });
    expect(await snap(a.contact.id)).toBe(before);
    expect((await t.prisma.contact.findUnique({ where: { id: b.contact.id } }))?.consentAt).not.toBeNull();
    // lote só com ids de A: nada muda
    const r2 = await t.as(t.B, 'POST', '/v1/contacts/consent', { contactIds: [a.contact.id], given: false, source: 'manual', reconsent: true });
    expect(r2.body).toMatchObject({ updated: 0, ignored: 1 });
    expect(await snap(a.contact.id)).toBe(before);
  });
  it('GET/listagem não vazam o consentimento de A para B', async () => {
    await t.prisma.contact.update({ where: { id: a.contact.id }, data: { consentAt: new Date(), consentSource: 'segredo-de-a' } });
    expect((await t.as(t.B, 'GET', `/v1/contacts/${a.contact.id}`)).status).toBe(404);
    expect(JSON.stringify((await t.as(t.B, 'GET', '/v1/contacts')).body)).not.toContain('segredo-de-a');
  });
  it('CSV de B com o telefone do contato de A cria contato em B e não toca em A', async () => {
    const before = await snap(a.contact.id);
    const r = await t.as(t.B, 'POST', '/v1/contacts/import', { csv: `telefone,consentimento\n${a.contact.phone},não\n` });
    expect(r.body.created).toBe(1);
    expect(await snap(a.contact.id)).toBe(before);
  });
  it('prévia de disparo de B com contactIds de A: matched 0', async () => {
    const r = await t.as(t.B, 'POST', '/v1/broadcasts/preview', { audience: { contactIds: [a.contact.id] } });
    expect(r.body).toMatchObject({ matched: 0, eligible: 0 });
  });
});
