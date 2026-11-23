import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type TwoTenants } from '../../test/two-tenants.js';

const days = (over: Record<string, unknown> = {}) => [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, enabled: day > 0 && day < 6, open: '08:00', close: '18:00', ...over }));

describe.skipIf(!hasTestDb)('fluxo: workspaces', () => {
  let t: TwoTenants;
  beforeAll(async () => { t = await setupTwoTenants(); }, 60_000);
  afterAll(async () => { await t?.teardown(); });

  it('H2-19: GET /v1/workspace e /v1/auth/me não devolvem a chave OpenAI criptografada', async () => {
    expect((await t.as(t.A, 'PUT', '/v1/workspace/ai-key', { apiKey: 'sk-' + 'a'.repeat(40) })).status).toBe(200);
    const ws = await t.as(t.A, 'GET', '/v1/workspace');
    const me = await t.as(t.A, 'GET', '/v1/auth/me');
    expect(JSON.stringify(ws.body)).not.toContain('openaiApiKeyEncrypted');
    expect(JSON.stringify(me.body)).not.toContain('openaiApiKeyEncrypted');
  });

  it('H2-20: PUT business-hours rejeita fuso horário inexistente (como o PATCH /workspace faz)', async () => {
    const r = await t.as(t.A, 'PUT', '/v1/workspace/business-hours', { timezone: 'Marte/Olympus', days: days() });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  it('H2-21: renomear fila para nome já existente responde 409, não 500', async () => {
    await t.as(t.A, 'POST', '/v1/workspace/departments', { name: 'Vendas' });
    const b = await t.as(t.A, 'POST', '/v1/workspace/departments', { name: 'Suporte' });
    const r = await t.as(t.A, 'PATCH', `/v1/workspace/departments/${b.body.id}`, { name: 'Vendas' });
    expect(r.status).toBe(409);
  });

  it('H2-38: PATCH parcial da fila não reseta cor, status ativo nem apaga os membros (defaults do zod em .partial())', async () => {
    const ws = (await t.as(t.A, 'GET', '/v1/workspace')).body;
    const me = ws.memberships[0];
    const d = await t.as(t.A, 'POST', '/v1/workspace/departments', { name: 'Financeiro', color: '#112233', isActive: false, memberIds: [me.id] });
    expect(d.status).toBe(201);
    const p = await t.as(t.A, 'PATCH', `/v1/workspace/departments/${d.body.id}`, { description: 'Cobranças' });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ color: '#112233', isActive: false });
    expect(p.body.members.length).toBe(1);
  });

  it('caminho feliz: workspace, horários, filas, convite, aceite, membros', async () => {
    expect((await t.as(t.A, 'PATCH', '/v1/workspace', { name: 'Empresa Ñ 日本', timezone: 'America/Sao_Paulo', locale: 'pt-BR' })).status).toBe(200);
    expect((await t.as(t.A, 'PATCH', '/v1/workspace', { timezone: 'Foo/Bar' })).status).toBe(422);
    expect((await t.as(t.A, 'PATCH', '/v1/workspace', {})).status).toBe(422);
    const put = await t.as(t.A, 'PUT', '/v1/workspace/business-hours', { timezone: 'America/Sao_Paulo', days: days() });
    expect(put.status).toBe(200);
    expect((await t.as(t.A, 'GET', '/v1/workspace/business-hours')).body.timezone).toBe('America/Sao_Paulo');
    expect((await t.as(t.A, 'PUT', '/v1/workspace/business-hours', { timezone: 'America/Sao_Paulo', days: days({ open: '18:00', close: '08:00' }) })).status).toBe(422);
    const email = `novo-${Date.now()}@Example.TEST`;
    const inv = await t.as(t.A, 'POST', '/v1/workspace/invitations', { email, name: 'Novo Agente', role: 'AGENT' });
    expect(inv.status).toBe(201);
    expect((await t.as(t.A, 'POST', '/v1/workspace/invitations', { email: email.toUpperCase() })).status).toBe(409);
    const acc = await t.app.inject({ method: 'POST', url: '/v1/invitations/accept', payload: { token: inv.body.acceptanceToken, name: 'Novo Agente', password: 'senha-super-segura-1' } });
    expect(acc.statusCode).toBe(201);
    const again = await t.app.inject({ method: 'POST', url: '/v1/invitations/accept', payload: { token: inv.body.acceptanceToken, name: 'Novo Agente', password: 'senha-super-segura-1' } });
    expect(again.statusCode).toBe(404);
    const login = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: email.toLowerCase(), password: 'senha-super-segura-1' } });
    expect(login.statusCode).toBe(200);
    const agent = { ...t.A, token: login.json().accessToken };
    expect((await t.as(agent, 'GET', '/v1/workspace/invitations')).status).toBe(403);
    const ws = (await t.as(t.A, 'GET', '/v1/workspace')).body;
    const m = ws.memberships.find((x: any) => x.user.email === email.toLowerCase());
    expect((await t.as(t.A, 'PATCH', `/v1/workspace/members/${m.id}`, { isActive: false })).status).toBe(200);
    // sessão do membro desativado cai na hora
    expect((await t.as(agent, 'GET', '/v1/contacts')).status).toBe(401);
    const refresh = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: login.json().refreshToken } });
    expect(refresh.statusCode).toBe(401);
  });

  it('último OWNER não pode ser rebaixado/desativado', async () => {
    const ws = (await t.as(t.A, 'GET', '/v1/workspace')).body;
    const me = ws.memberships.find((x: any) => x.user.id === t.A.userId);
    expect((await t.as(t.A, 'PATCH', `/v1/workspace/members/${me.id}`, { role: 'ADMIN' })).status).toBe(409);
  });

  it('chave de IA: formatos inválidos, remover', async () => {
    expect((await t.as(t.A, 'PUT', '/v1/workspace/ai-key', { apiKey: 'abc' })).status).toBe(422);
    expect((await t.as(t.A, 'DELETE', '/v1/workspace/ai-key')).body.configured).toBe(false);
  });

  it('auditoria: paginação e limite inválido', async () => {
    const p1 = await t.as(t.A, 'GET', '/v1/workspace/audit?limit=2');
    expect(p1.status).toBe(200); expect(p1.body.items.length).toBe(2);
    const p2 = await t.as(t.A, 'GET', `/v1/workspace/audit?limit=2&cursor=${p1.body.nextCursor}`);
    expect(p2.body.items.map((i: any) => i.id)).not.toContain(p1.body.items[0].id);
    expect((await t.as(t.A, 'GET', '/v1/workspace/audit?limit=abc')).status).toBe(200);
    expect((await t.as(t.A, 'GET', '/v1/workspace/audit?cursor=inexistente')).status).toBeLessThan(500);
  });
});
