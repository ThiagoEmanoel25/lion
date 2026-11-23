import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('fluxo: knowledge (API + indexador do runtime)', () => {
  let t: TwoTenants; let indexer: { index(id: string, content: string | null): Promise<void> };
  beforeAll(async () => { t = await setupTwoTenants(); const mod = await import(/* @vite-ignore */ `${'../../../../runtime/src/'}knowledge/knowledge-indexer.service.ts`); indexer = new mod.KnowledgeIndexerService(t.prisma as any); }, 60_000);
  afterAll(async () => { await t?.teardown(); });
  // reproduz o consumo do outbox feito por RuntimeWorkers.relayOutbox
  const drain = async (sourceId: string) => {
    const ev = await t.prisma.outboxEvent.findFirst({ where: { type: 'knowledge.index.requested', aggregateId: sourceId } });
    const p = ev!.payload as { sourceId: string; content: string | null };
    await indexer.index(p.sourceId, p.content);
    return t.prisma.knowledgeSource.findUniqueOrThrow({ where: { id: sourceId }, include: { _count: { select: { chunks: true } } } });
  };

  it('texto: criar -> indexar -> listar -> excluir', async () => {
    const r = await t.as(t.A, 'POST', '/v1/knowledge/sources', { name: 'Políticas', kind: 'text', content: ('Parágrafo útil sobre trocas e devoluções. '.repeat(40) + '\n\n').repeat(3) });
    expect(r.status).toBe(202);
    const s = await drain(r.body.id);
    expect(s.status).toBe('READY'); expect(s._count.chunks).toBeGreaterThan(1);
    expect((await t.as(t.A, 'GET', '/v1/knowledge/sources')).body.length).toBe(1);
    expect((await t.as(t.A, 'DELETE', `/v1/knowledge/sources/${r.body.id}`)).status).toBe(204);
    expect((await t.as(t.A, 'DELETE', `/v1/knowledge/sources/${r.body.id}`)).status).toBe(404);
  });

  it('H2-35: fonte do tipo "file" com conteúdo enviado deve ser indexada', async () => {
    const r = await t.as(t.A, 'POST', '/v1/knowledge/sources', { name: 'manual.txt', kind: 'file', content: 'Conteúdo do arquivo enviado pelo cliente.' });
    expect(r.status).toBe(202);
    expect((await drain(r.body.id)).status).toBe('READY');
  });

  it('H2-36: API não deve aceitar (202) fonte que o indexador sempre recusa (url, ou texto só com uri)', async () => {
    const url = await t.as(t.A, 'POST', '/v1/knowledge/sources', { name: 'Site', kind: 'url', uri: 'https://example.com/faq' });
    const textUri = await t.as(t.A, 'POST', '/v1/knowledge/sources', { name: 'Texto sem corpo', kind: 'text', uri: 'https://example.com/x' });
    for (const r of [url, textUri]) {
      if (r.status === 202) expect((await drain(r.body.id)).status, JSON.stringify(r.body)).toBe('READY');
    }
  });

  it('validações', async () => {
    expect((await t.as(t.A, 'POST', '/v1/knowledge/sources', { name: 'x', kind: 'text', content: 'abc' })).status).toBe(422);
    expect((await t.as(t.A, 'POST', '/v1/knowledge/sources', { name: 'Vazia', kind: 'text' })).status).toBe(422);
    expect((await t.as(t.A, 'POST', '/v1/knowledge/sources', { name: 'Gigante', kind: 'text', content: 'a'.repeat(100001) })).status).toBe(422);
  });
});
