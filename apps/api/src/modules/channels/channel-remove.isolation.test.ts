import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('isolamento entre workspaces: remover número', () => {
  let t: TwoTenants; let a: Fixtures;
  beforeAll(async () => { t = await setupTwoTenants(); a = await t.fixtures(t.A); }, 60_000);
  afterAll(async () => { await t?.teardown(); });

  it('DELETE /v1/channels/:id de outro workspace: 404 e canal de A intacto', async () => {
    const before = JSON.stringify(await t.prisma.channel.findUnique({ where: { id: a.channel.id } }));
    expect((await t.as(t.B, 'DELETE', `/v1/channels/${a.channel.id}`)).status).toBe(404);
    expect(JSON.stringify(await t.prisma.channel.findUnique({ where: { id: a.channel.id } }))).toBe(before);
    expect((await t.as(t.A, 'GET', '/v1/channels')).body.map((c: any) => c.id)).toContain(a.channel.id);
  });
  it('DELETE /v1/channels/:id sem autenticação: 401', async () => {
    const r = await t.app.inject({ method: 'DELETE', url: `/v1/channels/${a.channel.id}` });
    expect(r.statusCode).toBe(401);
  });
  it('DELETE em id inexistente: 404', async () => {
    expect((await t.as(t.A, 'DELETE', '/v1/channels/naoexiste')).status).toBe(404);
  });
});
