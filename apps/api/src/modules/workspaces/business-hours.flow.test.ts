import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';
// import dinâmico por variável: o tsconfig da API não habilita decorators do Nest, então o tsc não pode seguir estes arquivos.
const RT = '../../../../runtime/src/';

const days = (enabled: boolean) => [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, enabled, open: '00:00', close: '23:59' }));
const CLOSED = (outsideMessage: string) => ({ timezone: 'America/Sao_Paulo', days: days(false), outsideMessage });
const OPEN = (outsideMessage: string) => ({ timezone: 'America/Sao_Paulo', days: days(true), outsideMessage });

describe.skipIf(!hasTestDb)('fluxo: horário de atendimento aplicado no runtime', () => {
  let t: TwoTenants; let fx: Fixtures; let sessions: any; let workers: any; let redis: any; let spy: { mockRestore(): void };
  beforeAll(async () => {
    t = await setupTwoTenants(); fx = await t.fixtures(t.A);
    // relay só dos eventos de entrada deste workspace (o banco é compartilhado). Um único spy, restaurado no afterAll:
    // restaurar um spy de delegate do Prisma no meio do arquivo remove o método.
    const orig = t.prisma.outboxEvent.findMany.bind(t.prisma.outboxEvent);
    spy = vi.spyOn(t.prisma.outboxEvent, 'findMany').mockImplementation(((args: any) => orig({ ...args, where: { ...args.where, workspaceId: t.A.workspaceId, type: 'automation.inbound.received' } })) as any);
    redis = t.app.redis.duplicate({ maxRetriesPerRequest: null });
    const { WhatsAppSessionManager } = await import(/* @vite-ignore */ `${RT}whatsapp/session-manager.service.ts`);
    const { RuntimeWorkers } = await import(/* @vite-ignore */ `${RT}runtime-workers.service.ts`);
    sessions = new WhatsAppSessionManager(t.prisma as any, redis, {} as any);
    workers = new RuntimeWorkers(t.prisma as any, redis, sessions, {} as any, {} as any);
  }, 60_000);
  afterAll(async () => { spy?.mockRestore(); await sessions?.onModuleDestroy(); await redis?.quit(); await t?.teardown(); });

  const msg = (phone: string, text: string) => ({ type: 'notify', messages: [{ key: { remoteJid: `${phone}@s.whatsapp.net`, id: `ID${Math.random().toString(16).slice(2)}`, fromMe: false }, message: { conversation: text }, pushName: 'Cliente' }] });
  // chega a mensagem do cliente e o relay do outbox processa só os eventos de entrada deste workspace
  async function inbound(phone: string, text = 'oi') {
    await sessions.onMessages(fx.channel.id, msg(phone, text));
    const queue = { add: vi.fn().mockResolvedValue(undefined) };
    await workers.relayOutbox(queue, queue, queue);
  }
  const notices = async (phone: string) => t.prisma.message.findMany({ where: { workspaceId: t.A.workspaceId, authorType: 'outside_hours', conversation: { contact: { phone: `+${phone}` } } }, orderBy: { createdAt: 'asc' } });

  it('fora do horário a mensagem sai 1 vez; a segunda dentro da janela de 12 h não repete', async () => {
    expect((await t.as(t.A, 'PUT', '/v1/workspace/business-hours', CLOSED('Voltamos amanhã às 8h.'))).status).toBe(200);
    await inbound('5511955001001', 'olá');
    const first = await notices('5511955001001');
    expect(first.length).toBe(1);
    expect(first[0]).toMatchObject({ direction: 'OUTBOUND', body: 'Voltamos amanhã às 8h.', status: 'PENDING' });
    expect(await t.prisma.outboxEvent.count({ where: { aggregateId: first[0]!.id, type: 'message.send.requested' } })).toBe(1);
    await inbound('5511955001001', 'alguém aí?');
    await inbound('5511955001001', 'por favor');
    expect((await notices('5511955001001')).length).toBe(1);
    // a mensagem do cliente continua sendo registrada normalmente (nada é interrompido)
    const conv = await t.prisma.conversation.findFirstOrThrow({ where: { workspaceId: t.A.workspaceId, contact: { phone: '+5511955001001' } } });
    expect(await t.prisma.message.count({ where: { conversationId: conv.id, direction: 'INBOUND' } })).toBe(3);
  });

  it('depois de 12 h (janela expirada) o aviso volta a sair uma vez', async () => {
    const [prev] = await notices('5511955001001');
    await t.prisma.message.update({ where: { id: prev!.id }, data: { createdAt: new Date(Date.now() - 13 * 3_600_000) } });
    const conv = await t.prisma.conversation.findFirstOrThrow({ where: { workspaceId: t.A.workspaceId, contact: { phone: '+5511955001001' } } });
    await redis.del(`outside-hours:${conv.id}`); // TTL do claim expira junto com a janela
    await inbound('5511955001001', 'voltei');
    expect((await notices('5511955001001')).length).toBe(2);
  });

  it('dentro do horário nada é enviado', async () => {
    expect((await t.as(t.A, 'PUT', '/v1/workspace/business-hours', OPEN('Fechados.'))).status).toBe(200);
    await inbound('5511955001002');
    expect((await notices('5511955001002')).length).toBe(0);
  });

  it('sem mensagem configurada nada é enviado, mesmo fora do horário', async () => {
    expect((await t.as(t.A, 'PUT', '/v1/workspace/business-hours', CLOSED(''))).status).toBe(200);
    await inbound('5511955001003');
    expect((await notices('5511955001003')).length).toBe(0);
  });

  it('duas réplicas processando a mesma chegada não duplicam o aviso', async () => {
    expect((await t.as(t.A, 'PUT', '/v1/workspace/business-hours', CLOSED('Estamos fechados.'))).status).toBe(200);
    await sessions.onMessages(fx.channel.id, msg('5511955001004', 'oi'));
    const conv = await t.prisma.conversation.findFirstOrThrow({ where: { workspaceId: t.A.workspaceId, contact: { phone: '+5511955001004' } } });
    const { sendOutsideHoursNotice } = await import(/* @vite-ignore */ `${RT}automation/outside-hours.ts`);
    await Promise.all([1, 2, 3, 4].map(() => sendOutsideHoursNotice(t.prisma, redis, { workspaceId: t.A.workspaceId, conversationId: conv.id })));
    expect((await notices('5511955001004')).length).toBe(1);
  });
});
