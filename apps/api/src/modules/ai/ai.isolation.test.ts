import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type TwoTenants } from '../../test/two-tenants.js';

const agentBody = (extra: Record<string, unknown> = {}) => ({ name: 'Agente X', model: 'gpt-test', objective: 'Atender clientes com cortesia', systemPrompt: 'Responda com base na base de conhecimento.', handoffMessage: 'Vou chamar um humano', ...extra });

describe.skipIf(!hasTestDb)('isolamento entre workspaces: ai', () => {
  let t: TwoTenants; let aAgent: { id: string }; let bAgent: { id: string }; let aSrc: { id: string }; let bSrc: { id: string };
  const snap = async () => JSON.stringify(await t.prisma.aiAgent.findUnique({ where: { id: aAgent.id }, include: { knowledgeSources: true } }));
  const bSnap = async () => JSON.stringify(await t.prisma.aiAgent.findUnique({ where: { id: bAgent.id }, include: { knowledgeSources: true } }));
  beforeAll(async () => {
    t = await setupTwoTenants();
    aSrc = await t.prisma.knowledgeSource.create({ data: { workspaceId: t.A.workspaceId, name: 'Fonte A', kind: 'text', status: 'READY' } });
    bSrc = await t.prisma.knowledgeSource.create({ data: { workspaceId: t.B.workspaceId, name: 'Fonte B', kind: 'text', status: 'READY' } });
    const mk = (workspaceId: string, sourceId: string, name: string) => t.prisma.aiAgent.create({ data: { workspaceId, name, model: 'gpt-test', objective: 'Objetivo longo o bastante', systemPrompt: 'Prompt longo o bastante', handoffMessage: 'Humano', knowledgeSources: { create: [{ sourceId }] } } });
    aAgent = await mk(t.A.workspaceId, aSrc.id, 'Agente A'); bAgent = await mk(t.B.workspaceId, bSrc.id, 'Agente B');
  }, 60_000);
  afterAll(async () => { await t?.teardown(); });

  it('GET /v1/ai/agents: B não vê agentes nem fontes de A', async () => {
    const r = await t.as(t.B, 'GET', '/v1/ai/agents'); expect(r.status).toBe(200);
    expect(r.body.map((x: any) => x.id)).toEqual([bAgent.id]);
    expect(JSON.stringify(r.body)).not.toContain(aSrc.id);
  });
  it('PATCH/DELETE/test em agente de A por B: 404 e agente intacto', async () => {
    const before = await snap();
    expect((await t.as(t.B, 'PATCH', `/v1/ai/agents/${aAgent.id}`, { name: 'Invadido', isActive: false, knowledgeSourceIds: [] })).status).toBe(404);
    expect((await t.as(t.B, 'PATCH', `/v1/ai/agents/${aAgent.id}`, { knowledgeSourceIds: [bSrc.id] })).status).toBe(404);
    expect((await t.as(t.B, 'DELETE', `/v1/ai/agents/${aAgent.id}`)).status).toBe(404);
    expect((await t.as(t.B, 'POST', `/v1/ai/agents/${aAgent.id}/test`, { message: 'oi' })).status).toBe(404);
    expect(await snap()).toBe(before);
  });
  it('POST /v1/ai/agents com fonte de A: 422 e nada criado', async () => {
    const n = await t.prisma.aiAgent.count({ where: { workspaceId: t.B.workspaceId } });
    expect((await t.as(t.B, 'POST', '/v1/ai/agents', agentBody({ knowledgeSourceIds: [aSrc.id] }))).status).toBe(422);
    expect((await t.as(t.B, 'POST', '/v1/ai/agents', agentBody({ knowledgeSourceIds: [bSrc.id, aSrc.id] }))).status).toBe(422);
    expect(await t.prisma.aiAgent.count({ where: { workspaceId: t.B.workspaceId } })).toBe(n);
    expect(await t.prisma.agentKnowledgeSource.count({ where: { sourceId: aSrc.id } })).toBe(1);
  });
  it('PATCH de agente de B com fonte de A: 422 e vínculos de B intactos', async () => {
    const before = await bSnap();
    expect((await t.as(t.B, 'PATCH', `/v1/ai/agents/${bAgent.id}`, { name: 'Mudou', knowledgeSourceIds: [aSrc.id] })).status).toBe(422);
    expect(await bSnap()).toBe(before);
    expect(await t.prisma.agentKnowledgeSource.count({ where: { sourceId: aSrc.id } })).toBe(1);
  });
  it('POST /v1/ai/agents/:id/test em agente de B não usa trechos de A (fonte de A não vinculada)', async () => {
    await t.prisma.knowledgeChunk.create({ data: { workspaceId: t.A.workspaceId, sourceId: aSrc.id, ordinal: 0, content: 'segredo exclusivo de A' } });
    const r = await t.as(t.B, 'POST', `/v1/ai/agents/${bAgent.id}/test`, { message: 'segredo exclusivo' });
    expect(r.status).toBe(200); expect(r.body.knowledge.chunks).toBe(0);
    expect(JSON.stringify(r.body)).not.toContain('segredo exclusivo');
  });
  it('POST de agente por B pertence a B e A não o altera', async () => {
    const r = await t.as(t.B, 'POST', '/v1/ai/agents', agentBody({ knowledgeSourceIds: [bSrc.id] }));
    expect(r.status).toBe(201); expect(r.body.workspaceId).toBe(t.B.workspaceId);
    expect((await t.as(t.A, 'PATCH', `/v1/ai/agents/${r.body.id}`, { name: 'xx' })).status).toBe(404);
    expect((await t.as(t.A, 'DELETE', `/v1/ai/agents/${r.body.id}`)).status).toBe(404);
  });
});
