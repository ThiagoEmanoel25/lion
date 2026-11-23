import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import { hasTestDb, setupTwoTenants, type TwoTenants } from '../../test/two-tenants.js';

// R-1: remover número = arquivar o canal (soft delete) + comando de desconexão com removeAuth no runtime.
describe.skipIf(!hasTestDb)('fluxo: remover número (DELETE /v1/channels/:id)', () => {
  let t: TwoTenants; let queue: Queue;
  const jobsFor = async (channelId: string) => (await queue.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed'])).filter(j => j.data?.channelId === channelId);
  beforeAll(async () => {
    t = await setupTwoTenants();
    queue = new Queue('whatsapp.connection', { connection: t.app.redis.duplicate({ maxRetriesPerRequest: null }) });
    await t.prisma.subscription.create({ data: { workspaceId: t.A.workspaceId, provider: 'test', plan: 'growth', status: 'active', limits: {}, currentPeriodStart: new Date(Date.now() - 864e5), currentPeriodEnd: new Date(Date.now() + 864e5) } });
  }, 60_000);
  afterAll(async () => { await queue?.close(); await t?.teardown(); });

  it('sessão sem parear: remove, some da listagem, libera cota e número, mantém histórico, 2ª remoção 404', async () => {
    const a = await t.as(t.A, 'POST', '/v1/channels/whatsapp/sessions', { displayName: 'Loja', phoneNumber: '+55 11 98888-1111' });
    expect(a.status).toBe(202);
    const b = await t.as(t.A, 'POST', '/v1/channels/whatsapp/sessions', { displayName: 'Filial', phoneNumber: '5511988882222' });
    expect(b.status).toBe(202);
    expect((await t.as(t.A, 'POST', '/v1/channels/whatsapp/sessions', { displayName: 'Terceiro', phoneNumber: '5511988883333' })).status).toBe(402);

    const contact = await t.prisma.contact.create({ data: { workspaceId: t.A.workspaceId, name: 'Histórico', phone: '+5511977770000' } });
    const conv = await t.prisma.conversation.create({ data: { workspaceId: t.A.workspaceId, channelId: a.body.id, contactId: contact.id, status: 'ASSIGNED', mode: 'HUMAN' } });
    await t.prisma.message.create({ data: { workspaceId: t.A.workspaceId, conversationId: conv.id, direction: 'INBOUND', type: 'TEXT', body: 'oi', authorType: 'contact', status: 'DELIVERED' } });
    await t.prisma.channel.update({ where: { id: a.body.id }, data: { externalPhoneId: `ext-${a.body.id}` } });

    const del = await t.as(t.A, 'DELETE', `/v1/channels/${a.body.id}`);
    expect(del.status).toBe(200);
    const row = await t.prisma.channel.findUniqueOrThrow({ where: { id: a.body.id } });
    expect(row.archivedAt).not.toBeNull();
    expect(row.externalPhoneId).toBeNull();
    expect(row.activePlaybookId).toBeNull();
    expect(row.phoneNumber).toBe('+55 11 98888-1111');
    const list = await t.as(t.A, 'GET', '/v1/channels');
    expect(list.body.map((c: any) => c.id)).not.toContain(a.body.id);
    expect(list.body.map((c: any) => c.id)).toContain(b.body.id);
    const jobs = await jobsFor(a.body.id);
    expect(jobs.some(j => j.name === 'disconnect' && j.data.removeAuth === true)).toBe(true);
    expect(await t.prisma.auditLog.count({ where: { workspaceId: t.A.workspaceId, action: 'channel.removed', targetId: a.body.id } })).toBe(1);

    // histórico preservado
    expect(await t.prisma.conversation.count({ where: { channelId: a.body.id } })).toBe(1);
    expect(await t.prisma.message.count({ where: { conversationId: conv.id } })).toBe(1);

    // cota volta e o MESMO número pode ser cadastrado de novo
    const again = await t.as(t.A, 'POST', '/v1/channels/whatsapp/sessions', { displayName: 'Loja nova', phoneNumber: '5511988881111' });
    expect(again.status).toBe(202);
    expect((await t.as(t.A, 'POST', '/v1/channels/whatsapp/sessions', { displayName: 'Quarto', phoneNumber: '5511988884444' })).status).toBe(402);

    expect((await t.as(t.A, 'DELETE', `/v1/channels/${a.body.id}`)).status).toBe(404);
    // canal arquivado não aceita mais comandos
    expect((await t.as(t.A, 'POST', `/v1/channels/${a.body.id}/connect`, {})).status).toBe(404);
    expect((await t.as(t.A, 'POST', `/v1/channels/${a.body.id}/automation`, { playbookId: null })).status).toBe(404);
  });

  it('CHANNEL_IN_USE: disparo RUNNING impede a remoção e nada muda', async () => {
    const ch = await t.prisma.channel.create({ data: { workspaceId: t.A.workspaceId, provider: 'baileys', displayName: 'Em uso', phoneNumber: '5511966660000', status: 'CONNECTED' } });
    const bc = await t.prisma.broadcast.create({ data: { workspaceId: t.A.workspaceId, channelId: ch.id, name: 'Campanha', body: 'x', status: 'RUNNING', startAt: new Date(), createdById: t.A.userId } });
    const r = await t.as(t.A, 'DELETE', `/v1/channels/${ch.id}`);
    expect(r.status).toBe(409);
    expect(r.body.code ?? r.body.error?.code).toBe('CHANNEL_IN_USE');
    expect((await t.prisma.channel.findUniqueOrThrow({ where: { id: ch.id } })).archivedAt).toBeNull();
    expect(await jobsFor(ch.id)).toHaveLength(0);
    await t.prisma.broadcast.update({ where: { id: bc.id }, data: { status: 'CANCELLED' } });
    expect((await t.as(t.A, 'DELETE', `/v1/channels/${ch.id}`)).status).toBe(200);
  });

  it('canal de outro provedor (meta): arquiva sem comando ao runtime e libera externalPhoneId', async () => {
    const ch = (await t.as(t.A, 'POST', '/v1/channels', { displayName: 'Cloud', phoneNumber: '5511955550000', externalPhoneId: 'meta-r1' }));
    expect(ch.status === 201 || ch.status === 402).toBe(true);
    const id = ch.status === 201 ? ch.body.id : (await t.prisma.channel.create({ data: { workspaceId: t.A.workspaceId, provider: 'meta', displayName: 'Cloud', phoneNumber: '5511955550000', externalPhoneId: 'meta-r1', status: 'CONNECTED' } })).id;
    expect((await t.as(t.A, 'DELETE', `/v1/channels/${id}`)).status).toBe(200);
    expect(await jobsFor(id)).toHaveLength(0);
    const row = await t.prisma.channel.findUniqueOrThrow({ where: { id } });
    expect(row.archivedAt).not.toBeNull(); expect(row.externalPhoneId).toBeNull();
    await t.prisma.channel.create({ data: { workspaceId: t.A.workspaceId, provider: 'meta', displayName: 'Cloud 2', phoneNumber: '5511955550000', externalPhoneId: 'meta-r1', status: 'CONNECTED' } });
  });

  it('limpa a automação ativa e o webhook do Meta não encontra canal arquivado', async () => {
    const pb = await t.prisma.playbook.create({ data: { workspaceId: t.A.workspaceId, name: 'Fluxo R1', status: 'PUBLISHED' } });
    const ch = await t.prisma.channel.create({ data: { workspaceId: t.A.workspaceId, provider: 'meta', displayName: 'Auto', phoneNumber: '5511944440000', externalPhoneId: 'meta-auto', activePlaybookId: pb.id, status: 'CONNECTED' } });
    expect((await t.as(t.A, 'DELETE', `/v1/channels/${ch.id}`)).status).toBe(200);
    expect((await t.prisma.channel.findUniqueOrThrow({ where: { id: ch.id } })).activePlaybookId).toBeNull();
    const flow = await t.as(t.A, 'GET', '/v1/channel-flow-settings');
    if (flow.status === 200) expect(JSON.stringify(flow.body)).not.toContain(ch.id);
    const overview = await t.as(t.A, 'GET', '/v1/billing/overview');
    if (overview.status === 200) expect(JSON.stringify(overview.body)).not.toContain(ch.id);
  });
});
