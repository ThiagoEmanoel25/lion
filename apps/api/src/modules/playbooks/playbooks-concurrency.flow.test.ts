import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type Tenant, type TwoTenants } from '../../test/two-tenants.js';

/**
 * Concorrência: publicar/arquivar/desarquivar/salvar versão disparados juntos em vários fluxos.
 * As transações Serializable do Postgres abortam por falso positivo (SSI): a API precisa repetir, nunca dar 500.
 * Permitido: 2xx e 409 (conflito lógico). 503 TRY_AGAIN só se esgotar as tentativas: aqui exigimos 0.
 */
describe.skipIf(!hasTestDb)('fluxo: playbooks sob concorrência', () => {
  let t: TwoTenants;
  const flows: Array<{ tenant: Tenant; id: string; definition: any }> = [];
  const FLOWS = 12; const PER_FLOW = 6; const ROUNDS = 5;
  beforeAll(async () => {
    t = await setupTwoTenants();
    for (let i = 0; i < FLOWS; i += 1) {
      const tenant = i % 2 === 0 ? t.A : t.B;
      const pb = (await t.as(tenant, 'POST', '/v1/playbooks', { name: `Concorrência ${i}`, template: 'qualification' })).body;
      flows.push({ tenant, id: pb.id, definition: structuredClone(pb.versions[0].definition) });
    }
  }, 60_000);
  afterAll(async () => { await t?.teardown(); });

  it('nenhuma resposta 500/503 e estado final consistente', async () => {
    const bad: string[] = []; const statuses: Record<string, number> = {};
    for (let round = 0; round < ROUNDS; round += 1) {
      const calls: Array<Promise<void>> = [];
      for (const [index, flow] of flows.entries()) {
        const latest = await t.prisma.playbookVersion.findFirst({ where: { playbookId: flow.id }, orderBy: { version: 'desc' } });
        const current = latest!.version;
        const def = structuredClone(flow.definition); def.nodes[1].config.text = `texto r${round} f${index}`;
        const ops: Array<[string, string, unknown?]> = [
          ['versions', 'POST', { definition: def, expectedVersion: current }],
          ['publish', 'POST', { expectedVersion: current, testCaseIds: [] }],
          ['archive', 'POST', { confirmDetach: true }],
          ['unarchive', 'POST', {}],
          ['publish', 'POST', { expectedVersion: current, testCaseIds: [] }],
          ['archive', 'POST', { confirmDetach: true }]
        ];
        for (const [path, , body] of ops.slice(0, PER_FLOW)) {
          calls.push((async () => {
            const r = await t.as(flow.tenant, 'POST', `/v1/playbooks/${flow.id}/${path}`, body);
            statuses[`${path}:${r.status}`] = (statuses[`${path}:${r.status}`] ?? 0) + 1;
            if (r.status >= 500 || ![200, 201, 409].includes(r.status)) bad.push(`${path} -> ${r.status} ${r.body?.code ?? ''}`);
          })());
        }
      }
      await Promise.all(calls);
    }
    expect(bad, JSON.stringify(statuses)).toEqual([]);
    for (const flow of flows) {
      const pb = await t.prisma.playbook.findUniqueOrThrow({ where: { id: flow.id }, include: { versions: { orderBy: { version: 'asc' } } } });
      expect(pb.versions.map(v => v.version)).toEqual(pb.versions.map((_, i) => i + 1));
      if (pb.status === 'PUBLISHED') { expect(pb.activeVersionId).not.toBeNull(); expect(pb.archivedAt).toBeNull(); expect(pb.versions.find(v => v.id === pb.activeVersionId)?.publishedAt).not.toBeNull(); }
      else if (pb.status === 'ARCHIVED') { expect(pb.activeVersionId).toBeNull(); expect(pb.archivedAt).not.toBeNull(); }
      else expect(pb.archivedAt).toBeNull();
    }
  }, 120_000);
});
