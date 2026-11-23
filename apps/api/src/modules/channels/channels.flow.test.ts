import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';

describe.skipIf(!hasTestDb)('fluxo: channels + channel-flow-settings', () => {
  let t: TwoTenants; let fx: Fixtures;
  beforeAll(async () => { t = await setupTwoTenants(); fx = await t.fixtures(t.A); }, 60_000);
  afterAll(async () => { await t?.teardown(); });

  it('cota de canais do plano free (1) é respeitada em ambas as rotas de criação', async () => {
    expect((await t.as(t.A, 'POST', '/v1/channels', { displayName: 'Segundo', phoneNumber: '5511900002222' })).status).toBe(402);
    expect((await t.as(t.A, 'POST', '/v1/channels/whatsapp/sessions', { displayName: 'Segundo', phoneNumber: '5511900002222' })).status).toBe(402);
  });

  it('H2-40: externalPhoneId repetido (mesmo número em duas contas) responde 4xx e não 500', async () => {
    await t.prisma.subscription.create({ data: { workspaceId: t.B.workspaceId, provider: 'test', plan: 'scale', status: 'active', limits: {}, currentPeriodStart: new Date(Date.now() - 864e5), currentPeriodEnd: new Date(Date.now() + 864e5) } });
    const a = await t.as(t.B, 'POST', '/v1/channels', { displayName: 'Cloud API', phoneNumber: '5511900003333', externalPhoneId: 'ext-123' });
    expect(a.status).toBe(201);
    const b = await t.as(t.B, 'POST', '/v1/channels', { displayName: 'Cloud API 2', phoneNumber: '5511900003333', externalPhoneId: 'ext-123' });
    expect(b.status).toBeGreaterThanOrEqual(400); expect(b.status).toBeLessThan(500);
  });

  it('H2-41: o mesmo número de telefone não pode ser cadastrado em dois canais do mesmo workspace', async () => {
    const a = await t.as(t.B, 'POST', '/v1/channels/whatsapp/sessions', { displayName: 'Loja', phoneNumber: '+55 11 90000-4444' });
    const b = await t.as(t.B, 'POST', '/v1/channels/whatsapp/sessions', { displayName: 'Loja de novo', phoneNumber: '5511900004444' });
    expect(a.status).toBe(202);
    expect(b.status).toBeGreaterThanOrEqual(400);
  });

  it('canal: listar, sessão, automação, desconectar (sem Redis/runtime)', async () => {
    const l = await t.as(t.A, 'GET', '/v1/channels');
    expect(l.body.map((c: any) => c.id)).toContain(fx.channel.id);
    expect((await t.as(t.A, 'GET', `/v1/channels/${fx.channel.id}/session`)).status).toBe(200);
    expect((await t.as(t.A, 'GET', '/v1/channels/naoexiste/session')).status).toBe(404);
    expect((await t.as(t.A, 'POST', `/v1/channels/${fx.channel.id}/automation`, { playbookId: fx.playbook.id })).status).toBe(200);
    expect((await t.as(t.A, 'POST', `/v1/channels/${fx.channel.id}/automation`, { playbookId: null })).status).toBe(200);
    expect((await t.as(t.A, 'POST', `/v1/channels/${fx.channel.id}/disconnect`, {})).status).toBe(202);
  });

  it('flow-settings: caminho feliz, palavras-chave duplicadas, destino não publicado, bulk', async () => {
    const put = (body: unknown) => t.as(t.A, 'PUT', `/v1/channels/${fx.channel.id}/flow-settings`, body);
    const slots = { WELCOME: fx.playbook.id, DEFAULT_RESPONSE: null, CONVERSATION_RESOLVED: null, HANDOFF_CLOSED: null };
    const ok = await put({ slots, keywords: [{ keyword: 'Preço', match: 'CONTAINS', playbookId: fx.playbook.id }, { keyword: 'preço', match: 'EXACT', playbookId: fx.playbook.id }] });
    expect(ok.status).toBe(200);
    expect(ok.body.keywords.length).toBe(2);
    expect((await put({ slots, keywords: [{ keyword: 'Oi', match: 'EXACT', playbookId: fx.playbook.id }, { keyword: '  oi ', match: 'EXACT', playbookId: fx.playbook.id }] })).status).toBe(422);
    const draft = await t.prisma.playbook.create({ data: { workspaceId: t.A.workspaceId, name: 'Rascunho', status: 'DRAFT' } });
    expect((await put({ slots: { ...slots, WELCOME: draft.id }, keywords: [] })).status).toBe(422);
    expect((await put({ slots, keywords: [], defaultResponseWindowHours: 0 })).status).toBe(422);
    const bulk = await t.as(t.A, 'POST', '/v1/channel-flow-settings/bulk', { channelIds: [fx.channel.id], slots, keywords: [] });
    expect(bulk.status).toBe(200);
    expect((await t.as(t.A, 'POST', '/v1/channel-flow-settings/bulk', { channelIds: [fx.channel.id, fx.channel.id], slots, keywords: [] })).status).toBe(422);
    expect((await t.as(t.A, 'GET', '/v1/channel-flow-settings')).body.channels[0].flowConfigs.length).toBe(1);
  });

  it('H2-42: arquivar o fluxo ligado ao canal não deixa o canal apontando para ele', async () => {
    const pb = await t.prisma.playbook.findUniqueOrThrow({ where: { id: fx.playbook.id } });
    expect((await t.as(t.A, 'POST', `/v1/playbooks/${pb.id}/archive`, { confirmDetach: true })).status).toBe(200);
    const ch = await t.prisma.channel.findUniqueOrThrow({ where: { id: fx.channel.id }, include: { flowConfigs: true } });
    expect(ch.activePlaybookId).toBeNull(); expect(ch.flowConfigs.length).toBe(0);
  });
});
