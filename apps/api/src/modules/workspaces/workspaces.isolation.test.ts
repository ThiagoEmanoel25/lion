import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type TwoTenants } from '../../test/two-tenants.js';
import { createInviteToken } from './settings.js';

process.env.FIELD_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

describe.skipIf(!hasTestDb)('isolamento entre workspaces: workspaces (membros, convites, departamentos, configurações)', () => {
  let t: TwoTenants; const extraUsers: string[] = [];
  let memA: any; let memB: any; let deptA: any; let deptB: any; let inviteA: any; let inviteToken = '';
  const members: Record<string, { id: string; userId: string; token: string }> = {};
  const addMember = async (role: 'ADMIN' | 'SUPERVISOR' | 'AGENT' | 'VIEWER' | 'OWNER', tag = role) => {
    const u = await t.prisma.user.create({ data: { email: `${tag.toLowerCase()}-${t.A.workspaceId}@example.test`, name: tag, passwordHash: 'x' } });
    extraUsers.push(u.id);
    const m = await t.prisma.membership.create({ data: { workspaceId: t.A.workspaceId, userId: u.id, role } });
    return { id: m.id, userId: u.id, token: t.app.jwt.sign({ userId: u.id, workspaceId: t.A.workspaceId, role }) };
  };
  const call = (token: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    t.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload: payload as object } : {}) });
  // O aceite de convite tem rate limit por IP (Redis); zera para as execuções não interferirem entre si.
  const resetRateLimit = async () => { const keys = await t.app.redis.keys('nexo:rl:*'); if (keys.length) await t.app.redis.del(...keys); };
  const snapA = async () => JSON.stringify([
    await t.prisma.workspace.findUnique({ where: { id: t.A.workspaceId } }),
    await t.prisma.membership.findMany({ where: { workspaceId: t.A.workspaceId }, orderBy: { id: 'asc' } }),
    await t.prisma.workspaceInvite.findMany({ where: { workspaceId: t.A.workspaceId }, orderBy: { id: 'asc' } }),
    await t.prisma.department.findMany({ where: { workspaceId: t.A.workspaceId }, include: { members: true }, orderBy: { id: 'asc' } })
  ]);

  beforeAll(async () => {
    t = await setupTwoTenants();
    memA = await t.prisma.membership.findFirstOrThrow({ where: { workspaceId: t.A.workspaceId, userId: t.A.userId } });
    memB = await t.prisma.membership.findFirstOrThrow({ where: { workspaceId: t.B.workspaceId, userId: t.B.userId } });
    for (const role of ['ADMIN', 'SUPERVISOR', 'AGENT', 'VIEWER'] as const) members[role] = await addMember(role);
    deptA = (await t.as(t.A, 'POST', '/v1/workspace/departments', { name: 'Fila A', memberIds: [memA.id] })).body;
    deptB = (await t.as(t.B, 'POST', '/v1/workspace/departments', { name: 'Fila B', memberIds: [memB.id] })).body;
    expect(deptA?.id).toBeTruthy(); expect(deptB?.id).toBeTruthy();
    const gen = createInviteToken(); inviteToken = gen.token;
    inviteA = await t.prisma.workspaceInvite.create({ data: { workspaceId: t.A.workspaceId, email: `convidado-${t.A.workspaceId}@example.test`, role: 'AGENT', tokenHash: gen.hash, expiresAt: new Date(Date.now() + 86400_000), createdById: t.A.userId } });
    await t.as(t.A, 'PUT', '/v1/workspace/ai-key', { apiKey: 'sk-test-AAAAAAAAAAAA1111' });
    await t.as(t.A, 'PATCH', '/v1/workspace', { name: `Nome A ${t.A.workspaceId}` });
  }, 60_000);
  afterAll(async () => { await t?.prisma.user.deleteMany({ where: { id: { in: extraUsers } } }).catch(() => undefined); await t?.teardown(); });

  it('GET /v1/workspace de B: só o workspace e os membros de B, sem segredos', async () => {
    const r = await t.as(t.B, 'GET', '/v1/workspace');
    expect(r.status).toBe(200); expect(r.body.id).toBe(t.B.workspaceId);
    expect(r.body.memberships.map((m: any) => m.userId)).toEqual([t.B.userId]);
    const text = JSON.stringify(r.body);
    expect(text).not.toContain(t.A.email); expect(text).not.toContain(`Nome A`);
    expect(r.body.openaiApiKeyEncrypted ?? null).toBeNull();
  });
  it('GET /v1/workspace em A: nenhum papel (nem VIEWER) recebe a chave de IA cifrada', async () => {
    const stored = (await t.prisma.$queryRaw<Array<{ enc: string }>>`SELECT "openaiApiKeyEncrypted" AS enc FROM "Workspace" WHERE id = ${t.A.workspaceId}`)[0]!.enc;
    expect(stored).toBeTruthy();
    for (const token of [t.A.token, members.VIEWER!.token, members.AGENT!.token]) {
      const r = await call(token, 'GET', '/v1/workspace');
      expect(r.statusCode).toBe(200);
      expect(r.body).not.toContain(stored); expect(r.body).not.toContain('openaiApiKeyEncrypted');
    }
  });
  it('PATCH /v1/workspace de B (inclusive com id/slug de A no corpo): só altera B', async () => {
    const before = await snapA();
    const r = await t.as(t.B, 'PATCH', '/v1/workspace', { name: 'Renomeado B', id: t.A.workspaceId, slug: 'invadido' } as any);
    expect([200, 422]).toContain(r.status);
    expect((await t.prisma.workspace.findUniqueOrThrow({ where: { id: t.B.workspaceId } })).slug).not.toBe('invadido');
    expect(await snapA()).toBe(before);
  });
  it('ai-key e horário comercial: GET/PUT/DELETE de B não leem nem alteram os de A', async () => {
    expect((await t.as(t.B, 'GET', '/v1/workspace/ai-key')).body).toEqual({ configured: false, last4: null });
    expect((await t.as(t.A, 'GET', '/v1/workspace/ai-key')).body).toEqual({ configured: true, last4: '1111' });
    const before = await snapA();
    expect((await t.as(t.B, 'PUT', '/v1/workspace/ai-key', { apiKey: 'sk-test-BBBBBBBBBBBB2222' })).status).toBe(200);
    expect((await t.as(t.B, 'DELETE', '/v1/workspace/ai-key')).status).toBe(200);
    const bh = (await t.as(t.B, 'GET', '/v1/workspace/business-hours')).body;
    expect((await t.as(t.B, 'PUT', '/v1/workspace/business-hours', { ...bh, timezone: 'Asia/Tokyo' })).status).toBe(200);
    expect(await snapA()).toBe(before);
    expect((await t.as(t.A, 'GET', '/v1/workspace/ai-key')).body).toEqual({ configured: true, last4: '1111' });
  });
  it('convites: B não lista, não revoga e não vê o token de A; A permanece PENDING', async () => {
    const before = await snapA();
    const list = await t.as(t.B, 'GET', '/v1/workspace/invitations');
    expect(list.status).toBe(200); expect(JSON.stringify(list.body)).not.toContain(inviteA.email);
    expect((await t.as(t.B, 'DELETE', `/v1/workspace/invitations/${inviteA.id}`)).status).toBe(404);
    expect(await snapA()).toBe(before);
    expect((await t.prisma.workspaceInvite.findUniqueOrThrow({ where: { id: inviteA.id } })).status).toBe('PENDING');
  });
  it('POST /v1/workspace/invitations: convite criado por B pertence a B e não é visível a A', async () => {
    const r = await t.as(t.B, 'POST', '/v1/workspace/invitations', { email: `novo-b-${t.B.workspaceId}@example.test`, role: 'AGENT' });
    expect(r.status).toBe(201);
    expect((await t.prisma.workspaceInvite.findUniqueOrThrow({ where: { id: r.body.id } })).workspaceId).toBe(t.B.workspaceId);
    expect(JSON.stringify((await t.as(t.A, 'GET', '/v1/workspace/invitations')).body)).not.toContain(r.body.id);
    expect((await t.as(t.B, 'POST', '/v1/workspace/invitations', { email: `own-${t.B.workspaceId}@example.test`, role: 'OWNER' })).status).toBe(422);
  });
  it('aceite de convite: e-mail do corpo é ignorado (conta e papel vêm do convite) e token não é reutilizável', async () => {
    await resetRateLimit();
    const r = await t.app.inject({ method: 'POST', url: '/v1/invitations/accept', payload: { token: inviteToken, name: 'Intruso', password: 'senha-super-segura-1', email: t.B.email, workspaceId: t.B.workspaceId, role: 'OWNER' } });
    expect(r.statusCode).toBe(201);
    const user = await t.prisma.user.findUniqueOrThrow({ where: { email: inviteA.email } }); extraUsers.push(user.id);
    expect(r.json().workspaceId).toBe(t.A.workspaceId);
    const ms = await t.prisma.membership.findMany({ where: { userId: user.id } });
    expect(ms).toHaveLength(1); expect(ms[0]!.workspaceId).toBe(t.A.workspaceId); expect(ms[0]!.role).toBe('AGENT');
    expect(await t.prisma.membership.count({ where: { workspaceId: t.B.workspaceId } })).toBe(1);
    expect(await t.prisma.user.count({ where: { email: t.B.email } })).toBe(1);
    const again = await t.app.inject({ method: 'POST', url: '/v1/invitations/accept', payload: { token: inviteToken, name: 'Outro', password: 'senha-super-segura-2' } });
    expect(again.statusCode).toBe(404);
  });
  it('convite revogado, expirado ou com token inventado não pode ser aceito', async () => {
    await resetRateLimit();
    const revoked = createInviteToken();
    await t.prisma.workspaceInvite.create({ data: { workspaceId: t.A.workspaceId, email: `rev-${t.A.workspaceId}@example.test`, role: 'AGENT', tokenHash: revoked.hash, status: 'REVOKED', expiresAt: new Date(Date.now() + 86400_000), createdById: t.A.userId } });
    const expired = createInviteToken();
    await t.prisma.workspaceInvite.create({ data: { workspaceId: t.A.workspaceId, email: `exp-${t.A.workspaceId}@example.test`, role: 'AGENT', tokenHash: expired.hash, expiresAt: new Date(Date.now() - 1000), createdById: t.A.userId } });
    const accept = (token: string) => t.app.inject({ method: 'POST', url: '/v1/invitations/accept', payload: { token, name: 'Alguém', password: 'senha-super-segura-3' } });
    expect((await accept(revoked.token)).statusCode).toBe(404);
    expect((await accept(expired.token)).statusCode).toBe(410);
    expect((await accept(randomBytes(32).toString('base64url'))).statusCode).toBe(404);
    expect(await t.prisma.user.count({ where: { email: { in: [`rev-${t.A.workspaceId}@example.test`, `exp-${t.A.workspaceId}@example.test`] } } })).toBe(0);
  });
  it('PATCH /v1/workspace/members/:id de membro de A por B: 404 e A intacto', async () => {
    const before = await snapA();
    for (const body of [{ role: 'VIEWER' }, { isActive: false }, { role: 'OWNER' }]) expect((await t.as(t.B, 'PATCH', `/v1/workspace/members/${memA.id}`, body)).status).toBe(404);
    expect((await t.as(t.B, 'PATCH', `/v1/workspace/members/${members.AGENT!.id}`, { role: 'ADMIN' })).status).toBe(404);
    expect(await snapA()).toBe(before);
  });
  it('último OWNER: não pode ser rebaixado nem desativado (409), inclusive por si mesmo', async () => {
    const before = await snapA();
    expect((await t.as(t.B, 'PATCH', `/v1/workspace/members/${memB.id}`, { role: 'ADMIN' })).status).toBe(409);
    expect((await t.as(t.B, 'PATCH', `/v1/workspace/members/${memB.id}`, { isActive: false })).status).toBe(409);
    expect((await t.prisma.membership.findUniqueOrThrow({ where: { id: memB.id } })).role).toBe('OWNER');
    // Em A há um único OWNER ativo e um ADMIN: o ADMIN não pode tirar o OWNER (403) nem se promover.
    const admin = members.ADMIN!;
    expect((await call(admin.token, 'PATCH', `/v1/workspace/members/${memA.id}`, { role: 'ADMIN' })).statusCode).toBe(403);
    expect((await call(admin.token, 'PATCH', `/v1/workspace/members/${memA.id}`, { isActive: false })).statusCode).toBe(403);
    expect((await call(admin.token, 'PATCH', `/v1/workspace/members/${admin.id}`, { role: 'OWNER' })).statusCode).toBe(403);
    expect(await snapA()).toBe(before);
    expect((await t.as(t.A, 'PATCH', `/v1/workspace/members/${memA.id}`, { role: 'ADMIN' })).status).toBe(409);
    expect((await t.as(t.A, 'PATCH', `/v1/workspace/members/${memA.id}`, { isActive: false })).status).toBe(409);
  });
  it('com dois OWNERs, rebaixar um funciona e o restante vira o último (409)', async () => {
    const second = await addMember('OWNER', 'OWNER2' as any);
    expect((await t.as(t.A, 'PATCH', `/v1/workspace/members/${second.id}`, { role: 'ADMIN' })).status).toBe(200);
    expect((await t.as(t.A, 'PATCH', `/v1/workspace/members/${memA.id}`, { role: 'ADMIN' })).status).toBe(409);
    await t.prisma.membership.update({ where: { id: second.id }, data: { role: 'OWNER' } });
    const sess = await t.prisma.session.create({ data: { userId: second.userId, tokenHash: `iso-${randomBytes(8).toString('hex')}`, expiresAt: new Date(Date.now() + 86400_000) } });
    expect((await t.as(t.A, 'PATCH', `/v1/workspace/members/${second.id}`, { isActive: false })).status).toBe(200);
    expect((await t.prisma.session.findUniqueOrThrow({ where: { id: sess.id } })).revokedAt).not.toBeNull();
    expect((await call(second.token, 'GET', '/v1/workspace')).statusCode).toBe(401);
    expect((await t.as(t.A, 'PATCH', `/v1/workspace/members/${memA.id}`, { isActive: false })).status).toBe(409);
  });
  it('token com usuário de A e workspace de B (sem vínculo) é recusado (401)', async () => {
    const forged = t.app.jwt.sign({ userId: t.A.userId, workspaceId: t.B.workspaceId, role: 'OWNER' });
    for (const url of ['/v1/workspace', '/v1/workspace/invitations', '/v1/workspace/departments', '/v1/billing/overview']) expect((await call(forged, 'GET', url)).statusCode).toBe(401);
  });
  it('departamentos: B não lista, não lê nem altera filas de A; A intacto', async () => {
    const list = await t.as(t.B, 'GET', '/v1/workspace/departments');
    expect(list.body.map((d: any) => d.id)).toEqual([deptB.id]);
    expect(JSON.stringify(list.body)).not.toContain(t.A.email);
    const before = await snapA();
    expect((await t.as(t.B, 'PATCH', `/v1/workspace/departments/${deptA.id}`, { name: 'Invadida', isActive: false, memberIds: [] })).status).toBe(404);
    expect(await snapA()).toBe(before);
  });
  it('departamentos: membros de A em body de B são recusados (422) no POST e no PATCH', async () => {
    const n = await t.prisma.department.count({ where: { workspaceId: t.B.workspaceId } });
    expect((await t.as(t.B, 'POST', '/v1/workspace/departments', { name: 'Fila X', memberIds: [memA.id] })).status).toBe(422);
    expect((await t.as(t.B, 'POST', '/v1/workspace/departments', { name: 'Fila Y', memberIds: [memB.id, members.AGENT!.id] })).status).toBe(422);
    expect(await t.prisma.department.count({ where: { workspaceId: t.B.workspaceId } })).toBe(n);
    const before = JSON.stringify(await t.prisma.department.findUnique({ where: { id: deptB.id }, include: { members: true } }));
    expect((await t.as(t.B, 'PATCH', `/v1/workspace/departments/${deptB.id}`, { memberIds: [memA.id] })).status).toBe(422);
    expect(JSON.stringify(await t.prisma.department.findUnique({ where: { id: deptB.id }, include: { members: true } }))).toBe(before);
    expect(await t.prisma.departmentMember.count({ where: { departmentId: deptA.id, membershipId: memA.id } })).toBe(1);
  });
  it('auditoria: B não vê eventos de A', async () => {
    expect(await t.prisma.auditLog.count({ where: { workspaceId: t.A.workspaceId } })).toBeGreaterThan(0);
    const r = await t.as(t.B, 'GET', '/v1/workspace/audit?limit=100');
    expect(r.status).toBe(200);
    for (const item of r.body.items) expect(item.workspaceId).toBe(t.B.workspaceId);
    expect(JSON.stringify(r.body)).not.toContain(t.A.email);
  });
  it('RBAC em A: papéis sem permissão não alteram membros, convites, filas, chave de IA, horário nem workspace (403)', async () => {
    const before = await snapA();
    const reqs: Array<['GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', string, unknown?]> = [
      ['GET', '/v1/workspace/invitations'], ['GET', '/v1/workspace/audit'],
      ['POST', '/v1/workspace/invitations', { email: `x-${t.A.workspaceId}@example.test`, role: 'AGENT' }],
      ['DELETE', `/v1/workspace/invitations/${inviteA.id}`],
      ['PATCH', `/v1/workspace/members/${members.VIEWER!.id}`, { role: 'ADMIN' }],
      ['PATCH', `/v1/workspace/members/${members.AGENT!.id}`, { isActive: false }],
      ['POST', '/v1/workspace/departments', { name: 'Fila Z', memberIds: [] }],
      ['PATCH', `/v1/workspace/departments/${deptA.id}`, { name: 'Z' }],
      ['PATCH', '/v1/workspace', { name: 'Z' }],
      ['PUT', '/v1/workspace/ai-key', { apiKey: 'sk-test-ZZZZZZZZZZZZ9999' }],
      ['DELETE', '/v1/workspace/ai-key'],
      ['PUT', '/v1/workspace/business-hours', { timezone: 'UTC', days: [] }]
    ];
    for (const role of ['SUPERVISOR', 'AGENT', 'VIEWER'] as const) {
      for (const [m, url, body] of reqs) {
        const r = await call(members[role]!.token, m, url, body);
        expect(r.statusCode, `${role} ${m} ${url}`).toBe(403);
      }
    }
    // Só leitura de filas/horário/chave (sem segredo) continua liberada.
    expect((await call(members.VIEWER!.token, 'GET', '/v1/workspace/departments')).statusCode).toBe(200);
    expect(await snapA()).toBe(before);
  });
});
