import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('fluxo: ai', () => {
  let t: TwoTenants; let savedKey: string | undefined;
  beforeAll(async () => { savedKey = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY; t = await setupTwoTenants(); }, 60_000);
  afterAll(async () => { if (savedKey) process.env.OPENAI_API_KEY = savedKey; await t?.teardown(); });
  const agent = (over: Record<string, unknown> = {}) => ({ name: 'Ana', model: 'gpt-5.4-mini', objective: 'Qualificar leads de imóveis', systemPrompt: 'Você é a Ana, atendente educada da imobiliária.', handoffMessage: 'Vou chamar um colega.', ...over });

  it('caminho feliz: criar, listar, editar, testar sem provedor, excluir', async () => {
    const c = await t.as(t.A, 'POST', '/v1/ai/agents', agent());
    expect(c.status).toBe(201);
    expect((await t.as(t.A, 'GET', '/v1/ai/agents')).body.length).toBe(1);
    expect((await t.as(t.A, 'PATCH', `/v1/ai/agents/${c.body.id}`, { name: 'Ana Ñ 😀' })).body.name).toBe('Ana Ñ 😀');
    const test = await t.as(t.A, 'POST', `/v1/ai/agents/${c.body.id}/test`, { message: 'oi' });
    expect(test.status).toBeLessThan(500);
    expect((await t.as(t.A, 'POST', '/v1/ai/agents/naoexiste/test', { message: 'oi' })).status).toBe(404);
    expect((await t.as(t.A, 'DELETE', `/v1/ai/agents/${c.body.id}`)).status).toBe(204);
    expect((await t.as(t.A, 'DELETE', `/v1/ai/agents/${c.body.id}`)).status).toBe(404);
  });

  it('H2-37: PATCH parcial do agente não reseta campos omitidos (tom, limiar, ativo, fontes de conhecimento)', async () => {
    const src = await t.as(t.A, 'POST', '/v1/knowledge/sources', { name: 'FAQ2', kind: 'text', content: 'Conteúdo base de conhecimento.' });
    const c = await t.as(t.A, 'POST', '/v1/ai/agents', agent({ name: 'Cris', tone: 'concise', confidenceThreshold: 0.9, isActive: false, knowledgeSourceIds: [src.body.id] }));
    expect(c.status).toBe(201);
    const p = await t.as(t.A, 'PATCH', `/v1/ai/agents/${c.body.id}`, { name: 'Cris 2' });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ tone: 'concise', confidenceThreshold: 0.9, isActive: false });
    expect(p.body.knowledgeSources.length).toBe(1);
  });

  it('H2-33: chave OpenAI do workspace (Configurações) conta como provedor configurado para agentes', async () => {
    await t.as(t.A, 'PUT', '/v1/workspace/ai-key', { apiKey: 'sk-' + 'b'.repeat(40) });
    const c = await t.as(t.A, 'POST', '/v1/ai/agents', agent({ name: 'Bia' }));
    const status = await t.as(t.A, 'GET', '/v1/ai/provider-status');
    expect(status.body.providers[0].configured).toBe(true);
    const test = await t.as(t.A, 'POST', `/v1/ai/agents/${c.body.id}/test`, { message: 'oi' });
    expect(JSON.stringify(test.body)).not.toMatch(/"configured":false/);
  });

  it('provider-status com chave do workspace expõe só os últimos 4 dígitos e nunca a chave', async () => {
    const key = 'sk-' + 'c'.repeat(36) + 'WXYZ';
    await t.as(t.A, 'PUT', '/v1/workspace/ai-key', { apiKey: key });
    const status = await t.as(t.A, 'GET', '/v1/ai/provider-status');
    expect(status.body.providers[0]).toMatchObject({ name: 'openai', configured: true, source: 'workspace', last4: 'WXYZ' });
    expect(status.raw.body).not.toContain('cccc');
    const other = await t.as(t.B, 'GET', '/v1/ai/provider-status');
    expect(other.body.providers[0].configured).toBe(false);
    await t.as(t.A, 'DELETE', '/v1/workspace/ai-key');
    expect((await t.as(t.A, 'GET', '/v1/ai/provider-status')).body.providers[0].configured).toBe(false);
  });

  it('H2-34: fontes de conhecimento repetidas na lista não devem virar "fonte de outro workspace"', async () => {
    const src = await t.as(t.A, 'POST', '/v1/knowledge/sources', { name: 'FAQ', kind: 'text', content: 'Horário de funcionamento: 9h às 18h.' });
    expect(src.status).toBe(202);
    const r = await t.as(t.A, 'POST', '/v1/ai/agents', agent({ name: 'Dup', knowledgeSourceIds: [src.body.id, src.body.id] }));
    expect(r.status).toBe(201);
  });
});
