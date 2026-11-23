import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('fluxo: operational-settings', () => {
  let t: TwoTenants;
  beforeAll(async () => { t = await setupTwoTenants(); }, 60_000);
  afterAll(async () => { await t?.teardown(); });

  it('H2-39: PATCH do valor de uma variável sensível não a torna visível (default do zod em .partial())', async () => {
    const c = await t.as(t.A, 'POST', '/v1/global-variables', { name: 'token_api', value: 'segredo-1234', sensitive: true });
    expect(c.status).toBe(201);
    expect(c.body.value).toBeUndefined();
    const p = await t.as(t.A, 'PATCH', `/v1/global-variables/${c.body.id}`, { value: 'novo-segredo-9999' });
    expect(p.status).toBe(200);
    expect(p.body.sensitive).toBe(true);
    expect(p.body.value).toBeUndefined();
    const list = (await t.as(t.A, 'GET', '/v1/global-variables')).body;
    expect(JSON.stringify(list)).not.toContain('novo-segredo-9999');
  });

  it('variáveis globais: caminho feliz, duplicada, nome inválido, exclusão em uso', async () => {
    const a = await t.as(t.A, 'POST', '/v1/global-variables', { name: 'Link_Grupo', value: 'https://x.test/grupo' });
    expect(a.status).toBe(201); expect(a.body.name).toBe('link_grupo'); expect(a.body.value).toBe('https://x.test/grupo');
    expect((await t.as(t.A, 'POST', '/v1/global-variables', { name: 'LINK_GRUPO', value: 'x' })).status).toBe(409);
    for (const name of ['1abc', 'a b', 'á', 'a']) expect((await t.as(t.A, 'POST', '/v1/global-variables', { name, value: 'x' })).status).toBe(422);
    expect((await t.as(t.A, 'POST', '/v1/global-variables', { name: 'vazio', value: '' })).status).toBe(201);
    expect((await t.as(t.A, 'POST', '/v1/global-variables', { name: 'grande', value: 'x'.repeat(8193) })).status).toBe(422);
    expect((await t.as(t.A, 'PATCH', `/v1/global-variables/${a.body.id}`, { name: 'vazio' })).status).toBe(409);
    expect((await t.as(t.A, 'DELETE', `/v1/global-variables/${a.body.id}`)).status).toBe(204);
    expect((await t.as(t.A, 'DELETE', `/v1/global-variables/${a.body.id}`)).status).toBe(404);
  });

  it('respostas rápidas: criar, atalho normalizado, duplicada, buscar, editar, excluir', async () => {
    const a = await t.as(t.A, 'POST', '/v1/quick-replies', { shortcut: '/Ola', body: 'Olá! Como posso ajudar? 😀' });
    expect(a.status).toBe(201); expect(a.body.shortcut).toBe('ola');
    expect((await t.as(t.A, 'POST', '/v1/quick-replies', { shortcut: 'OLA', body: 'x' })).status).toBe(409);
    const b = await t.as(t.A, 'POST', '/v1/quick-replies', { shortcut: 'preco', body: 'Tabela de preços' });
    expect((await t.as(t.A, 'PATCH', `/v1/quick-replies/${b.body.id}`, { shortcut: '/ola' })).status).toBe(409);
    expect((await t.as(t.A, 'GET', '/v1/quick-replies?search=PREÇ')).body.length).toBe(1);
    expect((await t.as(t.A, 'PATCH', `/v1/quick-replies/${b.body.id}`, { body: 'Nova tabela' })).body.shortcut).toBe('preco');
    expect((await t.as(t.A, 'POST', '/v1/quick-replies', { shortcut: 'a', body: 'x' })).status).toBe(422);
    expect((await t.as(t.A, 'POST', '/v1/quick-replies', { shortcut: 'com espaco', body: 'x' })).status).toBe(422);
    expect((await t.as(t.A, 'POST', '/v1/quick-replies', { shortcut: 'okk', body: 'x'.repeat(4097) })).status).toBe(422);
    expect((await t.as(t.A, 'DELETE', `/v1/quick-replies/${b.body.id}`)).status).toBe(204);
    expect((await t.as(t.A, 'PATCH', `/v1/quick-replies/${b.body.id}`, { body: 'x' })).status).toBe(404);
  });
});
