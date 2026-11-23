import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('fluxo: playbooks', () => {
  let t: TwoTenants; let fx: Fixtures;
  beforeAll(async () => { t = await setupTwoTenants(); fx = await t.fixtures(t.A); }, 60_000);
  afterAll(async () => { await t?.teardown(); });

  const create = async (name = 'Fluxo de teste') => (await t.as(t.A, 'POST', '/v1/playbooks', { name, template: 'qualification' })).body;

  it('caminho feliz: criar, salvar versão, conflito, publicar, pausar, retomar, arquivar, desarquivar', async () => {
    const pb = await create();
    expect(pb.versions.length).toBe(1);
    const def = structuredClone(pb.versions[0].definition);
    const same = await t.as(t.A, 'POST', `/v1/playbooks/${pb.id}/versions`, { definition: def, expectedVersion: 1 });
    expect(same.status).toBe(409);
    def.nodes[1].config.text = 'Olá 😀! Bem-vindo à Ñandú';
    const v2 = await t.as(t.A, 'POST', `/v1/playbooks/${pb.id}/versions`, { definition: def, expectedVersion: 1 });
    expect(v2.status).toBe(201);
    expect((await t.as(t.A, 'POST', `/v1/playbooks/${pb.id}/versions`, { definition: def, expectedVersion: 1 })).status).toBe(409);
    expect((await t.as(t.A, 'POST', `/v1/playbooks/${pb.id}/publish`, { expectedVersion: 1 })).status).toBe(409);
    const pub = await t.as(t.A, 'POST', `/v1/playbooks/${pb.id}/publish`, { expectedVersion: 2, testCaseIds: [] });
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe('PUBLISHED');
    expect((await t.as(t.A, 'POST', `/v1/playbooks/${pb.id}/publish`, { expectedVersion: 2, testCaseIds: [] })).status).toBe(200);
    expect((await t.as(t.A, 'POST', `/v1/playbooks/${pb.id}/pause`)).status).toBe(200);
    expect((await t.as(t.A, 'POST', `/v1/playbooks/${pb.id}/pause`)).status).toBe(409);
    expect((await t.as(t.A, 'POST', `/v1/playbooks/${pb.id}/resume`)).status).toBe(200);
    const imp = await t.as(t.A, 'GET', `/v1/playbooks/${pb.id}/archive-impact`);
    expect(imp.status).toBe(200);
    expect((await t.as(t.A, 'POST', `/v1/playbooks/${pb.id}/archive`, {})).status).toBe(200);
    expect((await t.as(t.A, 'POST', `/v1/playbooks/${pb.id}/versions`, { definition: def, expectedVersion: 2 })).status).toBe(409);
    expect((await t.as(t.A, 'POST', `/v1/playbooks/${pb.id}/unarchive`)).status).toBe(200);
    const list = await t.as(t.A, 'GET', '/v1/playbooks');
    expect(list.body.find((p: any) => p.id === pb.id).blocks).toBeGreaterThan(0);
  });

  it('H2-25: duas execuções manuais simultâneas na mesma conversa criam só uma', async () => {
    const rs = await Promise.all([1, 2, 3].map(() => t.as(t.A, 'POST', `/v1/playbooks/${fx.playbook.id}/executions`, { conversationId: fx.conversation.id, context: {} })));
    expect(rs.filter(r => r.status === 202).length).toBe(1);
    expect(rs.every(r => r.status < 500)).toBe(true);
    expect(await t.prisma.execution.count({ where: { conversationId: fx.conversation.id } })).toBe(1);
  });

  it('H2-26: cancelar execução gera evento de outbox que o runtime sabe consumir', async () => {
    const ex = await t.prisma.execution.create({ data: { workspaceId: t.A.workspaceId, conversationId: fx.conversation.id, playbookVersionId: (await t.prisma.playbook.findUniqueOrThrow({ where: { id: fx.playbook.id } })).activeVersionId!, status: 'WAITING', context: {} } });
    expect((await t.as(t.A, 'POST', `/v1/executions/${ex.id}/cancel`)).status).toBe(200);
    expect((await t.as(t.A, 'POST', `/v1/executions/${ex.id}/cancel`)).status).toBe(409);
    const ev = await t.prisma.outboxEvent.findFirst({ where: { aggregateId: ex.id, type: 'automation.execution.cancelled' } });
    expect(ev).not.toBeNull();
    // relayOutbox (runtime-workers.service.ts) só busca os tipos da lista fixa: este não está nela.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../../../runtime/src/runtime-workers.service.ts', import.meta.url), 'utf8');
    const relayList = src.slice(src.indexOf("type: { in: ["), src.indexOf("processedAt: null", src.indexOf("type: { in: [")));
    expect(relayList).toContain('automation.execution.cancelled');
  });

  it('pastas: criar, duplicada 409, renomear para existente 409, mover, excluir', async () => {
    const f1 = await t.as(t.A, 'POST', '/v1/playbook-folders', { name: 'Pasta 1' });
    expect(f1.status).toBe(201);
    expect((await t.as(t.A, 'POST', '/v1/playbook-folders', { name: 'Pasta 1' })).status).toBe(409);
    const f2 = await t.as(t.A, 'POST', '/v1/playbook-folders', { name: 'Pasta 2' });
    expect((await t.as(t.A, 'PATCH', `/v1/playbook-folders/${f2.body.id}`, { name: 'Pasta 1' })).status).toBe(409);
    expect((await t.as(t.A, 'PATCH', `/v1/playbooks/${fx.playbook.id}/folder`, { folderId: f1.body.id })).status).toBe(200);
    expect((await t.as(t.A, 'DELETE', `/v1/playbook-folders/${f1.body.id}`)).status).toBe(204);
    expect((await t.as(t.A, 'GET', `/v1/playbooks/${fx.playbook.id}`)).body.folderId).toBeNull();
  });

  it('bordas: nome curto/longo/unicode, template inválido, id inexistente', async () => {
    expect((await t.as(t.A, 'POST', '/v1/playbooks', { name: 'ab', template: 'support' })).status).toBe(422);
    expect((await t.as(t.A, 'POST', '/v1/playbooks', { name: 'x'.repeat(121), template: 'support' })).status).toBe(422);
    expect((await t.as(t.A, 'POST', '/v1/playbooks', { name: '日本語 😀 Ñ', template: 'support' })).status).toBe(201);
    expect((await t.as(t.A, 'POST', '/v1/playbooks', { name: 'Fluxo', template: 'nada' })).status).toBe(422);
    expect((await t.as(t.A, 'GET', '/v1/playbooks/inexistente')).status).toBe(404);
    expect((await t.as(t.A, 'POST', '/v1/playbooks/inexistente/validate', { definition: {} })).status).toBeLessThan(500);
    expect((await t.as(t.A, 'GET', `/v1/playbooks/${fx.playbook.id}/executions?limit=9999`)).status).toBeLessThan(500);
  });
});
