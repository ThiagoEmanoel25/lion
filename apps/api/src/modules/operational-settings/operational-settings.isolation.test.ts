import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';

process.env.FIELD_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

describe.skipIf(!hasTestDb)('isolamento entre workspaces: operational-settings', () => {
  let t: TwoTenants; let a: Fixtures; let b: Fixtures; let qr: any; let gv: any; let gvSecret: any; let assetA: any; let assetB: any; let agentId = ''; let agentToken = '';
  const snapQr = async () => JSON.stringify(await t.prisma.quickReply.findUnique({ where: { id: qr.id } }));
  const snapGv = async () => JSON.stringify(await t.prisma.globalVariable.findMany({ where: { workspaceId: t.A.workspaceId }, orderBy: { id: 'asc' } }));
  beforeAll(async () => {
    t = await setupTwoTenants(); a = await t.fixtures(t.A); b = await t.fixtures(t.B);
    assetA = await t.prisma.playbookAsset.create({ data: { workspaceId: t.A.workspaceId, fileName: 'a.png', contentType: 'image/png', size: 1, data: Buffer.from('a') } });
    assetB = await t.prisma.playbookAsset.create({ data: { workspaceId: t.B.workspaceId, fileName: 'b.png', contentType: 'image/png', size: 1, data: Buffer.from('b') } });
    qr = await t.prisma.quickReply.create({ data: { workspaceId: t.A.workspaceId, shortcut: 'segredoa', shortcutNormalized: 'segredoa', body: 'corpo secreto A', assetId: assetA.id, createdById: t.A.userId } });
    gv = (await t.as(t.A, 'POST', '/v1/global-variables', { name: 'nome_a', value: 'valor-publico-A' })).body;
    gvSecret = (await t.as(t.A, 'POST', '/v1/global-variables', { name: 'token_a', value: 'valor-sensivel-A', sensitive: true })).body;
    expect(gv?.id).toBeTruthy(); expect(gvSecret?.id).toBeTruthy();
    const u = await t.prisma.user.create({ data: { email: `agent-${t.A.workspaceId}@example.test`, name: 'Agent', passwordHash: 'x' } });
    agentId = u.id; await t.prisma.membership.create({ data: { workspaceId: t.A.workspaceId, userId: u.id, role: 'AGENT' } });
    agentToken = t.app.jwt.sign({ userId: u.id, workspaceId: t.A.workspaceId, role: 'AGENT' });
  }, 60_000);
  afterAll(async () => { await t?.prisma.user.deleteMany({ where: { id: agentId } }).catch(() => undefined); await t?.teardown(); });

  it('GET /v1/quick-replies: B não vê respostas de A (nem por busca)', async () => {
    for (const qs of ['', '?search=segredoa', '?search=secreto']) {
      const r = await t.as(t.B, 'GET', `/v1/quick-replies${qs}`);
      expect(r.status).toBe(200); expect(JSON.stringify(r.body)).not.toContain('secreto A');
    }
  });
  it('PATCH/DELETE /v1/quick-replies/:id de A por B: 404 e A intacta', async () => {
    const before = await snapQr();
    expect((await t.as(t.B, 'PATCH', `/v1/quick-replies/${qr.id}`, { body: 'invadido' })).status).toBe(404);
    expect((await t.as(t.B, 'DELETE', `/v1/quick-replies/${qr.id}`)).status).toBe(404);
    expect(await snapQr()).toBe(before);
  });
  it('POST/PATCH quick-reply com assetId de A: 422 e nada vincula o arquivo de A', async () => {
    expect((await t.as(t.B, 'POST', '/v1/quick-replies', { shortcut: 'x1', body: 'x', assetId: assetA.id })).status).toBe(422);
    const own = (await t.as(t.B, 'POST', '/v1/quick-replies', { shortcut: 'proprio', body: 'x', assetId: assetB.id }));
    expect(own.status).toBe(201);
    expect((await t.as(t.B, 'PATCH', `/v1/quick-replies/${own.body.id}`, { assetId: assetA.id })).status).toBe(422);
    expect((await t.prisma.quickReply.findUnique({ where: { id: own.body.id } }))!.assetId).toBe(assetB.id);
  });
  it('atalho igual ao de A é permitido em B e não altera A', async () => {
    const before = await snapQr();
    expect((await t.as(t.B, 'POST', '/v1/quick-replies', { shortcut: 'segredoa', body: 'meu' })).status).toBe(201);
    expect(await snapQr()).toBe(before);
  });
  it('GET /v1/global-variables: B não vê variáveis de A', async () => {
    const r = await t.as(t.B, 'GET', '/v1/global-variables');
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.body);
    for (const leak of [gv.id, gvSecret.id, 'nome_a', 'token_a', 'valor-publico-A']) expect(text).not.toContain(leak);
  });
  it('PATCH/DELETE /v1/global-variables/:id de A por B: 404 e A intacta (inclusive com confirm=true)', async () => {
    const before = await snapGv();
    for (const id of [gv.id, gvSecret.id]) {
      expect((await t.as(t.B, 'PATCH', `/v1/global-variables/${id}`, { value: 'invadido', sensitive: false })).status).toBe(404);
      expect((await t.as(t.B, 'DELETE', `/v1/global-variables/${id}?confirm=true`)).status).toBe(404);
    }
    expect(await snapGv()).toBe(before);
  });
  it('nome igual ao de A em B: cria em B e não vaza/altera o valor de A', async () => {
    const before = await snapGv();
    const r = await t.as(t.B, 'POST', '/v1/global-variables', { name: 'nome_a', value: 'valor-B' });
    expect(r.status).toBe(201); expect(r.body.value).toBe('valor-B');
    expect(await snapGv()).toBe(before);
    expect((await t.prisma.globalVariable.findUniqueOrThrow({ where: { id: r.body.id } })).workspaceId).toBe(t.B.workspaceId);
  });
  it('RBAC em A: AGENT lê, mas não cria/altera/apaga respostas rápidas nem variáveis (403)', async () => {
    const before = [await snapQr(), await snapGv()];
    const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => t.app.inject({ method, url, headers: { authorization: `Bearer ${agentToken}` }, ...(payload ? { payload: payload as object } : {}) });
    expect((await call('GET', '/v1/quick-replies')).statusCode).toBe(200);
    expect((await call('POST', '/v1/quick-replies', { shortcut: 'novo', body: 'x' })).statusCode).toBe(403);
    expect((await call('PATCH', `/v1/quick-replies/${qr.id}`, { body: 'x' })).statusCode).toBe(403);
    expect((await call('DELETE', `/v1/quick-replies/${qr.id}`)).statusCode).toBe(403);
    expect((await call('POST', '/v1/global-variables', { name: 'novo', value: 'x' })).statusCode).toBe(403);
    expect((await call('PATCH', `/v1/global-variables/${gv.id}`, { value: 'x' })).statusCode).toBe(403);
    expect((await call('DELETE', `/v1/global-variables/${gv.id}`)).statusCode).toBe(403);
    expect([await snapQr(), await snapGv()]).toEqual(before);
  });
  it('variável sensível de A nunca expõe o valor, nem para o dono de A', async () => {
    const r = await t.as(t.A, 'GET', '/v1/global-variables');
    expect(JSON.stringify(r.body)).not.toContain('valor-sensivel-A');
  });
});
