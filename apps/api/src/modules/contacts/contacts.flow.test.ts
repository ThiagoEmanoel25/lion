import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('fluxo: contacts', () => {
  let t: TwoTenants;
  beforeAll(async () => { t = await setupTwoTenants(); }, 60_000);
  afterAll(async () => { await t?.teardown(); });
  const post = (body: any) => t.as(t.A, 'POST', '/v1/contacts', body);

  it('H2-01: PATCH sem email NÃO deve apagar o e-mail existente', async () => {
    const c = await post({ name: 'Ana', phone: '+5511988880001', email: 'ana@example.com' });
    expect(c.status).toBe(201);
    const p = await t.as(t.A, 'PATCH', `/v1/contacts/${c.body.id}`, { name: 'Ana Maria' });
    expect(p.status).toBe(200);
    expect(p.body.email).toBe('ana@example.com');
  });

  it('H2-02: o mesmo número com/sem "+" não deve criar dois contatos (runtime grava +E164)', async () => {
    const a = await post({ name: 'Bia', phone: '+5511988880002' });
    const b = await post({ name: 'Bia 2', phone: '5511988880002' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(409);
  });

  it('H2-03: telefone sem dígitos (8+ letras) deve ser rejeitado, não gravado vazio', async () => {
    const r = await post({ name: 'Letras', phone: 'abcdefgh' });
    expect([400, 422]).toContain(r.status);
  });

  it('caminho feliz: criar, listar, buscar, editar, tags e paginação', async () => {
    const tag = await t.as(t.A, 'POST', '/v1/contact-tags', { name: 'vip', color: '#ff0000' });
    expect([201, 400, 422]).toContain(tag.status);
    const dup = await t.as(t.A, 'POST', '/v1/contact-tags', { name: 'vip', color: '#ff0000' });
    expect(dup.status).toBe(tag.status === 201 ? 409 : dup.status);
    for (let i = 0; i < 55; i++) await t.prisma.contact.create({ data: { workspaceId: t.A.workspaceId, phone: `+55119000${String(i).padStart(5, '0')}`, name: `Zpag ${i}` } });
    const p1 = await t.as(t.A, 'GET', '/v1/contacts?search=Zpag');
    expect(p1.body.items.length).toBe(50);
    const p2 = await t.as(t.A, 'GET', `/v1/contacts?search=Zpag&cursor=${p1.body.nextCursor}`);
    expect(p2.body.items.length).toBe(5);
    expect(new Set([...p1.body.items, ...p2.body.items].map((c: any) => c.id)).size).toBe(55);
  });

  it('unicode, limites e cursor inválido', async () => {
    const u = await post({ name: 'José Ñandú 日本語 😀', phone: '+5511988880010' });
    expect(u.status).toBe(201);
    expect((await t.as(t.A, 'GET', '/v1/contacts?search=ñandú')).body.items.length).toBe(1);
    expect((await post({ name: 'x'.repeat(121), phone: '+5511988880011' })).status).toBeLessThan(500);
    expect((await t.as(t.A, 'GET', '/v1/contacts?cursor=naoexiste')).status).toBeLessThan(500);
    expect((await t.as(t.A, 'GET', '/v1/contacts/naoexiste')).status).toBe(404);
  });

  it('concorrência: duas criações iguais -> 1x201 e 1x409 (sem 500)', async () => {
    const rs = await Promise.all([post({ name: 'Dup', phone: '+5511988880020' }), post({ name: 'Dup', phone: '+5511988880020' })]);
    expect(rs.map(r => r.status).sort()).toEqual([201, 409]);
  });

  it('import CSV duas vezes é idempotente; updateExisting atualiza', async () => {
    const csv = 'nome,telefone,email,tags\nCarla,+5511977770001,carla@example.com,a;b\nDiego,"+55 11 97777-0002",,\n';
    const r1 = await t.as(t.A, 'POST', '/v1/contacts/import', { csv });
    expect(r1.status).toBe(200);
    expect(r1.body.created).toBe(2);
    const r2 = await t.as(t.A, 'POST', '/v1/contacts/import', { csv });
    expect(r2.body.created).toBe(0);
    const r3 = await t.as(t.A, 'POST', '/v1/contacts/import', { csv, updateExisting: false });
    expect(r3.body.failed).toBe(2);
    expect(await t.prisma.contact.count({ where: { workspaceId: t.A.workspaceId, phone: { in: ['+5511977770001', '+5511977770002'] } } })).toBe(2);
  });

  it('H2-05: import com nome de etiqueta/CSV com linhas duplicadas no mesmo arquivo não deve dar 500', async () => {
    const csv = 'nome,telefone\nE,+5511966660001\nE2,+5511966660001\n';
    const r = await t.as(t.A, 'POST', '/v1/contacts/import', { csv });
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(1);
  });

  it('H2-07: reimportar CSV sem colunas etapa/tags não deve resetar etapa nem apagar etiquetas', async () => {
    const tag = await t.prisma.tag.create({ data: { workspaceId: t.A.workspaceId, name: 'keep-me' } });
    const c = await t.prisma.contact.create({ data: { workspaceId: t.A.workspaceId, phone: '+5511955550001', name: 'Fiel', stage: 'won', tags: { create: [{ tagId: tag.id }] } } });
    const r = await t.as(t.A, 'POST', '/v1/contacts/import', { csv: 'telefone,nome\n+5511955550001,Fiel Renomeado\n' });
    expect(r.status).toBe(200);
    const after = await t.prisma.contact.findUnique({ where: { id: c.id }, include: { tags: true } });
    expect(after!.name).toBe('Fiel Renomeado');
    expect(after!.stage).toBe('won');
    expect(after!.tags.length).toBe(1);
  });

  it('H2-06: cota de contatos do plano', async () => {
    await t.prisma.subscription.create({ data: { workspaceId: t.B.workspaceId, provider: 'test', plan: 'free', status: 'active', limits: { contacts: 2 }, currentPeriodStart: new Date(Date.now() - 864e5), currentPeriodEnd: new Date(Date.now() + 864e5) } as any }).catch(() => undefined);
    const mk = (n: number) => t.as(t.B, 'POST', '/v1/contacts', { name: `Q${n}`, phone: `+551195550000${n}` });
    expect((await mk(1)).status).toBe(201); expect((await mk(2)).status).toBe(201);
    const third = await mk(3);
    expect(third.status).toBeGreaterThanOrEqual(400); expect(third.status).toBeLessThan(500);
  });

  it('telefone canônico: legado sem "+" é reaproveitado (POST 409, PATCH 409, CSV atualiza a mesma linha) e grava +E.164', async () => {
    const legacy = await t.prisma.contact.create({ data: { workspaceId: t.A.workspaceId, phone: '5511940000001', name: 'Legado' } });
    expect((await post({ name: 'Dup', phone: '(11) 94000-0001' })).status).toBe(409);
    const other = await post({ name: 'Outro', phone: '11 94000-0009' });
    expect(other.status).toBe(201); expect(other.body.phone).toBe('+5511940000009');
    expect((await t.as(t.A, 'PATCH', `/v1/contacts/${other.body.id}`, { phone: '+55 11 94000-0001' })).status).toBe(409);
    const r = await t.as(t.A, 'POST', '/v1/contacts/import', { csv: 'telefone,nome\n"+55 11 94000-0001",Legado Novo\n' });
    expect(r.status).toBe(200); expect(r.body.updated).toBe(1); expect(r.body.created).toBe(0);
    const rows = await t.prisma.contact.findMany({ where: { workspaceId: t.A.workspaceId, phone: { in: ['5511940000001', '+5511940000001'] } } });
    expect(rows.length).toBe(1); expect(rows[0]!.id).toBe(legacy.id); expect(rows[0]!.phone).toBe('+5511940000001'); expect(rows[0]!.name).toBe('Legado Novo');
  });

  it('H2-03: telefone só com letras responde 422 INVALID_PHONE e não cria contato', async () => {
    const n = await t.prisma.contact.count({ where: { workspaceId: t.A.workspaceId } });
    const r = await post({ name: 'Letras', phone: 'abcdefgh' });
    expect(r.status).toBe(422); expect(r.body.code).toBe('INVALID_PHONE');
    expect(await t.prisma.contact.count({ where: { workspaceId: t.A.workspaceId } })).toBe(n);
  });

  it('H2-01: e-mail "" explícito limpa; omitido preserva', async () => {
    const c = await post({ name: 'Eva', phone: '+5511988880031', email: 'eva@example.com' });
    expect((await t.as(t.A, 'PATCH', `/v1/contacts/${c.body.id}`, { name: 'Eva 2' })).body.email).toBe('eva@example.com');
    expect((await t.as(t.A, 'PATCH', `/v1/contacts/${c.body.id}`, { email: '' })).body.email).toBeNull();
  });
});
