import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('fluxo: consentimento do contato', () => {
  let t: TwoTenants;
  beforeAll(async () => { t = await setupTwoTenants(); }, 60_000);
  afterAll(async () => { await t?.teardown(); });
  const mk = async (phone: string, extra: object = {}) => (await t.as(t.A, 'POST', '/v1/contacts', { name: 'C', phone, ...extra })).body;
  const preview = (ids: string[]) => t.as(t.A, 'POST', '/v1/broadcasts/preview', { audience: { contactIds: ids } });

  it('contato novo não tem consentimento; prévia: eligible 0, noConsent 1', async () => {
    const c = await mk('+5511977000001');
    expect(c.consent).toMatchObject({ given: false, at: null, source: null });
    expect((await preview([c.id])).body).toMatchObject({ matched: 1, eligible: 0, skipped: { noConsent: 1, optedOut: 0 } });
  });

  it('caminho completo: consent.given -> eligible 1 -> opt-out -> inelegível -> 409 sem reconsent -> reconsent -> elegível', async () => {
    const c = await mk('+5511977000002');
    const p = await t.as(t.A, 'PATCH', `/v1/contacts/${c.id}`, { consent: { given: true, source: 'whatsapp_optin' } });
    expect(p.status).toBe(200);
    expect(p.body.consent).toMatchObject({ given: true, source: 'whatsapp_optin', eligible: true });
    expect(p.body.consent.at).toBeTruthy();
    expect(p.body.consentById).toBeUndefined();
    const row = await t.prisma.contact.findUnique({ where: { id: c.id } });
    expect(row?.consentById).toBe(t.A.userId);
    expect((await preview([c.id])).body).toMatchObject({ eligible: 1, skipped: { noConsent: 0, optedOut: 0 } });
    // GET e listagem devolvem o estado
    expect((await t.as(t.A, 'GET', `/v1/contacts/${c.id}`)).body.consent.given).toBe(true);
    expect((await t.as(t.A, 'GET', '/v1/contacts?search=5511977000002')).body.items[0].consent.given).toBe(true);
    // runtime registra SAIR
    await t.prisma.contact.update({ where: { id: c.id }, data: { optedOutAt: new Date() } });
    expect((await preview([c.id])).body).toMatchObject({ eligible: 0, skipped: { optedOut: 1 } });
    const blocked = await t.as(t.A, 'PATCH', `/v1/contacts/${c.id}`, { consent: { given: true, source: 'manual' } });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('CONTACT_OPTED_OUT');
    expect((await t.prisma.contact.findUnique({ where: { id: c.id } }))?.optedOutAt).not.toBeNull();
    expect(await t.prisma.auditLog.count({ where: { workspaceId: t.A.workspaceId, targetId: c.id, action: 'contact.consent_blocked_opted_out' } })).toBe(1);
    expect((await preview([c.id])).body.eligible).toBe(0);
    const re = await t.as(t.A, 'PATCH', `/v1/contacts/${c.id}`, { consent: { given: true, source: 'manual', reconsent: true } });
    expect(re.status).toBe(200);
    expect(re.body.consent).toMatchObject({ optedOut: false, eligible: true });
    expect(await t.prisma.auditLog.count({ where: { workspaceId: t.A.workspaceId, targetId: c.id, action: 'contact.consent_reconsented' } })).toBe(1);
    expect((await preview([c.id])).body.eligible).toBe(1);
  });

  it('revogação: given:false limpa consentAt, mantém trilha e a prévia volta a noConsent', async () => {
    const c = await mk('+5511977000003', { consent: { given: true, source: 'form' } });
    expect(c.consent).toMatchObject({ given: true, source: 'form' });
    const r = await t.as(t.A, 'PATCH', `/v1/contacts/${c.id}`, { consent: { given: false, source: 'manual' } });
    expect(r.body.consent).toMatchObject({ given: false, at: null, source: 'manual' });
    expect(r.body.consent.revokedAt).toBeTruthy();
    expect((await preview([c.id])).body.skipped.noConsent).toBe(1);
    const trail = await t.prisma.auditLog.findMany({ where: { targetId: c.id, action: { startsWith: 'contact.consent_' } }, orderBy: { createdAt: 'asc' } });
    expect(trail.map(a => a.action)).toEqual(['contact.consent_granted', 'contact.consent_revoked']);
  });

  it('PATCH sem consent não mexe no consentimento; given:true repetido preserva a prova original', async () => {
    const c = await mk('+5511977000004', { consent: { given: true, source: 'csv' } });
    const before = (await t.prisma.contact.findUnique({ where: { id: c.id } }))!;
    await t.as(t.A, 'PATCH', `/v1/contacts/${c.id}`, { name: 'Outro nome' });
    await t.as(t.A, 'PATCH', `/v1/contacts/${c.id}`, { consent: { given: true, source: 'manual' } });
    const after = (await t.prisma.contact.findUnique({ where: { id: c.id } }))!;
    expect(after.consentAt).toEqual(before.consentAt);
    expect(after.consentSource).toBe('csv');
  });

  it('origem inválida é 400/422', async () => {
    const c = await mk('+5511977000005');
    expect([400, 422]).toContain((await t.as(t.A, 'PATCH', `/v1/contacts/${c.id}`, { consent: { given: true, source: 'x y!' } })).status);
  });

  it('lote: atualiza, ignora inexistentes e opt-out sem reconsent, conta unchanged', async () => {
    const a = await mk('+5511977000006'); const b = await mk('+5511977000007'); const out = await mk('+5511977000008', { consent: { given: true, source: 'manual' } });
    await t.prisma.contact.update({ where: { id: out.id }, data: { optedOutAt: new Date() } });
    const done = await mk('+5511977000009', { consent: { given: true, source: 'manual' } });
    const r = await t.as(t.A, 'POST', '/v1/contacts/consent', { contactIds: [a.id, b.id, out.id, done.id, 'inexistente', a.id], given: true, source: 'csv' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ requested: 5, updated: 2, unchanged: 1, ignored: 2, ignoredReasons: { notFound: 1, optedOut: 1 } });
    expect((await preview([a.id, b.id, out.id])).body).toMatchObject({ eligible: 2, skipped: { optedOut: 1 } });
    const re = await t.as(t.A, 'POST', '/v1/contacts/consent', { contactIds: [out.id], given: true, source: 'manual', reconsent: true });
    expect(re.body).toMatchObject({ updated: 1, ignored: 0 });
    const rev = await t.as(t.A, 'POST', '/v1/contacts/consent', { contactIds: [a.id, b.id], given: false, source: 'manual' });
    expect(rev.body.updated).toBe(2);
    expect((await t.as(t.A, 'POST', '/v1/contacts/consent', { contactIds: [], given: true })).status).toBeGreaterThanOrEqual(400);
    expect((await t.as(t.A, 'POST', '/v1/contacts/consent', { contactIds: Array.from({ length: 501 }, (_, i) => `id${i}`), given: true })).status).toBeGreaterThanOrEqual(400);
  });

  it('CSV: com coluna consentimento grava origem csv; sem a coluna não infere; opt-out não volta; valor inválido vira erro de linha', async () => {
    const csv = 'telefone,nome,consentimento\n+5511966000001,Sim,sim\n+5511966000002,Nao,não\n+5511966000003,Vazio,\n+5511966000004,Yes,YES\n+5511966000005,Ruim,talvez\n';
    const r = await t.as(t.A, 'POST', '/v1/contacts/import', { csv });
    expect(r.body).toMatchObject({ created: 4, failed: 1, consentRecorded: 2 });
    const rows = await t.prisma.contact.findMany({ where: { workspaceId: t.A.workspaceId, phone: { startsWith: '+551196600000' } }, orderBy: { phone: 'asc' } });
    expect(rows.map(x => [x.phone.slice(-1), x.consentAt !== null, x.consentSource])).toEqual([['1', true, 'csv'], ['2', false, null], ['3', false, null], ['4', true, 'csv']]);
    // sem coluna: não infere nem apaga
    const r2 = await t.as(t.A, 'POST', '/v1/contacts/import', { csv: 'telefone,nome\n+5511966000001,Sim Renomeado\n+5511966000009,Novo\n' });
    expect(r2.body).toMatchObject({ created: 1, updated: 1, consentRecorded: 0 });
    expect((await t.prisma.contact.findFirst({ where: { workspaceId: t.A.workspaceId, phone: '+5511966000001' } }))?.consentAt).not.toBeNull();
    expect((await t.prisma.contact.findFirst({ where: { workspaceId: t.A.workspaceId, phone: '+5511966000009' } }))?.consentAt).toBeNull();
    // opt-out não volta pelo CSV; 'não' revoga
    await t.prisma.contact.updateMany({ where: { workspaceId: t.A.workspaceId, phone: '+5511966000002' }, data: { optedOutAt: new Date() } });
    const r3 = await t.as(t.A, 'POST', '/v1/contacts/import', { csv: 'telefone,consentimento\n+5511966000002,sim\n+5511966000001,n\n' });
    expect(r3.body).toMatchObject({ consentSkippedOptedOut: 1, consentRecorded: 1 });
    expect((await t.prisma.contact.findFirst({ where: { workspaceId: t.A.workspaceId, phone: '+5511966000002' } }))).toMatchObject({ consentAt: null });
    expect((await t.prisma.contact.findFirst({ where: { workspaceId: t.A.workspaceId, phone: '+5511966000001' } }))?.consentAt).toBeNull();
  });
});
