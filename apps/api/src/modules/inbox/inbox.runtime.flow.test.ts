import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { hasTestDb, setupTwoTenants, type Fixtures, type TwoTenants } from '../../test/two-tenants.js';
// import dinâmico por variável: o tsconfig da API não habilita decorators do Nest, então o tsc não pode seguir estes arquivos.
const RT = '../../../../runtime/src/';

// Exercita o runtime (sessão Baileys e relay do outbox) contra o banco real, sem WhatsApp: chama os handlers privados.
describe.skipIf(!hasTestDb)('fluxo runtime: inbound, broadcast e gatilhos', () => {
  let t: TwoTenants; let fx: Fixtures; let sessions: any; let workers: any; let redis: any;
  beforeAll(async () => {
    t = await setupTwoTenants(); fx = await t.fixtures(t.A);
    redis = t.app.redis.duplicate({ maxRetriesPerRequest: null });
    const { WhatsAppSessionManager } = await import(/* @vite-ignore */ `${RT}whatsapp/session-manager.service.ts`);
    const { RuntimeWorkers } = await import(/* @vite-ignore */ `${RT}runtime-workers.service.ts`);
    sessions = new WhatsAppSessionManager(t.prisma as any, redis, {} as any);
    workers = new RuntimeWorkers(t.prisma as any, redis, sessions, {} as any, {} as any);
  }, 60_000);
  afterAll(async () => { await sessions?.onModuleDestroy(); await redis?.quit(); await t?.teardown(); });
  const msg = (jid: string, text: string, id = `ID${Math.random().toString(16).slice(2)}`, pushName = 'Cliente') => ({ type: 'notify', messages: [{ key: { remoteJid: jid, id, fromMe: false }, message: { conversation: text }, pushName }] });

  it('inbound de contato novo: cria contato +E164, conversa e mensagem; reentrega do mesmo id é idempotente', async () => {
    const ev = msg('5511966001001@s.whatsapp.net', 'Olá');
    await sessions.onMessages(fx.channel.id, ev); await sessions.onMessages(fx.channel.id, ev);
    const c = await t.prisma.contact.findFirstOrThrow({ where: { workspaceId: t.A.workspaceId, phone: '+5511966001001' } });
    expect(await t.prisma.message.count({ where: { conversation: { contactId: c.id }, direction: 'INBOUND' } })).toBe(1);
    expect(await t.prisma.outboxEvent.count({ where: { aggregateId: (await t.prisma.conversation.findFirstOrThrow({ where: { contactId: c.id } })).id, type: 'automation.inbound.received' } })).toBe(1);
  });

  it('SAIR/PARAR registra opt-out do contato', async () => {
    await sessions.onMessages(fx.channel.id, msg('5511966001002@s.whatsapp.net', 'SAIR'));
    const c = await t.prisma.contact.findFirstOrThrow({ where: { workspaceId: t.A.workspaceId, phone: '+5511966001002' } });
    expect(c.optedOutAt).not.toBeNull();
  });

  it('H2-46: mensagem de GRUPO (@g.us) não pode virar contato/conversa nem disparar automação', async () => {
    await sessions.onMessages(fx.channel.id, msg('120363025246125486@g.us', 'bom dia grupo'));
    expect(await t.prisma.contact.count({ where: { workspaceId: t.A.workspaceId, phone: { contains: '120363025246125486' } } })).toBe(0);
  });

  it('H2-47: contato que já tem número criado pela API sem "+" recebe a resposta no MESMO contato', async () => {
    const created = await t.as(t.A, 'POST', '/v1/contacts', { name: 'Veio da planilha', phone: '5511966001003' });
    expect(created.status).toBe(201);
    await sessions.onMessages(fx.channel.id, msg('5511966001003@s.whatsapp.net', 'oi, vi seu anúncio'));
    expect(await t.prisma.contact.count({ where: { workspaceId: t.A.workspaceId, phone: { contains: '5511966001003' } } })).toBe(1);
  });

  it('H2-48: um erro de banco no meio do lote não pode descartar em silêncio as mensagens seguintes do lote', async () => {
    const good = msg('5511966001004@s.whatsapp.net', 'segunda').messages[0]!;
    // falha só a 1ª chamada e depois delega ao Prisma real (o spy com mockRejectedValueOnce devolvia null nas chamadas seguintes)
    const origFind = t.prisma.channel.findUnique.bind(t.prisma.channel); let blips = 0;
    const spy = vi.spyOn(t.prisma.channel, 'findUnique').mockImplementation(((args: any) => (blips++ === 0 ? Promise.reject(new Error('db blip')) : origFind(args))) as any);
    // handler chamado com `void` em session-manager.service.ts: a rejeição vira unhandledRejection e o lote inteiro se perde
    await expect(sessions.onMessages(fx.channel.id, { type: 'notify', messages: [msg('5511966001005@s.whatsapp.net', 'primeira').messages[0], good] })).resolves.toBeUndefined();
    spy.mockRestore();
    expect(await t.prisma.contact.count({ where: { workspaceId: t.A.workspaceId, phone: '+5511966001004' } })).toBe(1);
  });

  it('H2-49: disparo com canal momentaneamente fora (reconectando) não pode marcar todos como SKIPPED definitivamente', async () => {
    const c = await t.prisma.contact.create({ data: { workspaceId: t.A.workspaceId, phone: '+5511966001006', consentAt: new Date() } });
    const ch = await t.prisma.channel.create({ data: { workspaceId: t.A.workspaceId, provider: 'baileys', displayName: 'Reconectando', phoneNumber: '5511900009999', status: 'DEGRADED' } });
    const b = await t.prisma.broadcast.create({ data: { workspaceId: t.A.workspaceId, channelId: ch.id, name: 'x', body: 'oi', startAt: new Date(), createdById: t.A.userId, status: 'RUNNING' } });
    const r = await t.prisma.broadcastRecipient.create({ data: { broadcastId: b.id, contactId: c.id, scheduledFor: new Date() } });
    await workers.dispatchBroadcastRecipient(r.id);
    const after = await t.prisma.broadcastRecipient.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.status).toBe('PENDING');
    expect((await t.prisma.broadcast.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('RUNNING');
  });

  it('H2-50: conversa em atendimento HUMANO não deve disparar fluxo por palavra-chave/boas-vindas', async () => {
    const contact = await t.prisma.contact.create({ data: { workspaceId: t.A.workspaceId, phone: '+5511966001007' } });
    const conv = await t.prisma.conversation.create({ data: { workspaceId: t.A.workspaceId, channelId: fx.channel.id, contactId: contact.id, status: 'ASSIGNED', mode: 'HUMAN', assigneeId: t.A.userId } });
    const m = await t.prisma.message.create({ data: { workspaceId: t.A.workspaceId, conversationId: conv.id, direction: 'INBOUND', type: 'TEXT', body: 'preço', authorType: 'contact', status: 'DELIVERED' } });
    const pb = await t.prisma.playbook.findUniqueOrThrow({ where: { id: fx.playbook.id } });
    await t.prisma.channelKeyword.create({ data: { channelId: fx.channel.id, keyword: 'preço', normalizedKeyword: 'preço', match: 'CONTAINS', playbookId: pb.id } });
    const queue = { add: vi.fn().mockResolvedValue(undefined) };
    await workers.startTriggeredExecution(queue, { triggerEvent: 'message.received', conversationId: conv.id, messageId: m.id, jobOptions: {} });
    expect(await t.prisma.execution.count({ where: { conversationId: conv.id } })).toBe(0);
  });

  it('H2-51: evento de envio que falha 10x no relay não pode deixar a mensagem QUEUED para sempre sem aviso', async () => {
    const m = await t.prisma.message.create({ data: { workspaceId: t.A.workspaceId, conversationId: fx.conversation.id, direction: 'OUTBOUND', type: 'TEXT', body: 'x', authorType: 'user', status: 'QUEUED' } });
    const ev = await t.prisma.outboxEvent.create({ data: { workspaceId: t.A.workspaceId, aggregate: 'Message', aggregateId: m.id, type: 'message.send.requested', payload: { messageId: m.id } } });
    const orig = t.prisma.outboxEvent.findMany.bind(t.prisma.outboxEvent);
    const spy = vi.spyOn(t.prisma.outboxEvent, 'findMany').mockImplementation(((args: any) => orig({ ...args, where: { ...args.where, id: ev.id } })) as any);
    const queue = { add: vi.fn().mockRejectedValue(new Error('redis down')) };
    for (let i = 0; i < 12; i++) {
      await workers.relayOutbox(queue, queue, queue);
      await t.prisma.outboxEvent.update({ where: { id: ev.id }, data: { availableAt: new Date(Date.now() - 1000) } });
    }
    spy.mockRestore();
    const after = await t.prisma.outboxEvent.findUniqueOrThrow({ where: { id: ev.id } });
    const msgAfter = await t.prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.attempts).toBe(10);
    expect(after.processedAt).toBeNull();
    // esperado: ao esgotar as tentativas a mensagem vira FAILED para o atendente ver; obtido: continua QUEUED
    expect(msgAfter.status).toBe('FAILED');
  });

  it('H2-52: duas réplicas do runtime processando o mesmo destinatário de disparo não duplicam a mensagem ao cliente', async () => {
    const contacts = await Promise.all([1, 2, 3, 4, 5, 6].map(i => t.prisma.contact.create({ data: { workspaceId: t.A.workspaceId, phone: `+551196610${i}000`, consentAt: new Date() } })));
    const b = await t.prisma.broadcast.create({ data: { workspaceId: t.A.workspaceId, channelId: fx.channel.id, name: 'corrida', body: 'oi', startAt: new Date(), createdById: t.A.userId, status: 'RUNNING' } });
    const recs = await Promise.all(contacts.map(c => t.prisma.broadcastRecipient.create({ data: { broadcastId: b.id, contactId: c.id, scheduledFor: new Date() } })));
    await Promise.all(recs.flatMap(r => [workers.dispatchBroadcastRecipient(r.id), workers.dispatchBroadcastRecipient(r.id)]));
    for (const r of recs) {
      const n = await t.prisma.message.count({ where: { conversation: { contactId: r.contactId }, direction: 'OUTBOUND', body: 'oi' } });
      expect(n, r.id).toBe(1);
    }
  });
});
