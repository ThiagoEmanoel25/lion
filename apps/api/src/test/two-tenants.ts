/**
 * Helper de isolamento multi-tenant com Postgres/Redis REAIS.
 * Requer TEST_DATABASE_URL (migrado) e TEST_REDIS_URL no ambiente; sem TEST_DATABASE_URL, use `hasTestDb`
 * em `describe.skipIf(!hasTestDb)` para pular.
 *
 *   const t = await setupTwoTenants();          // sobe buildApp() e cria workspaces A e B (1 OWNER cada)
 *   t.A / t.B: {workspaceId,userId,email,token}  // token = JWT assinado direto (sem rota de login)
 *   t.as(t.B, 'GET', '/v1/contacts/'+id, body?)  // inject autenticado -> {status, body, raw}
 *   const fx = await t.fixtures(t.A)            // contact,tag,channel,playbook(publicado),conversation,message,
 *                                               // scheduled,board,column,column2,card (todos do tenant A)
 *   t.prisma                                    // PrismaClient do app, para conferir o banco
 *   await t.teardown();                         // remove os dados criados e fecha o app
 */
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

export type Tenant = { workspaceId: string; userId: string; email: string; token: string };
export type Fixtures = Awaited<ReturnType<TwoTenants['fixtures']>>;
export type TwoTenants = Awaited<ReturnType<typeof setupTwoTenants>>;

export async function setupTwoTenants(opts: { role?: 'OWNER' | 'ADMIN' } = {}) {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL ausente');
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379';
  process.env.JWT_SECRET ??= 'isolation-test-secret-isolation-test-secret';
  process.env.LOG_LEVEL = 'silent';
  const { buildApp } = await import('../app.js');
  const app: FastifyInstance = await buildApp();
  await app.ready();
  const prisma = app.prisma as PrismaClient;
  const run = randomBytes(4).toString('hex');
  const passwordHash = await argon2.hash('isolation-pass-123');
  const workspaceIds: string[] = [];
  const userIds: string[] = [];

  async function makeTenant(label: string): Promise<Tenant> {
    const ws = await prisma.workspace.create({ data: { name: `Iso ${label} ${run}`, slug: `iso-${label.toLowerCase()}-${run}` } });
    const email = `iso-${label.toLowerCase()}-${run}@example.test`;
    const user = await prisma.user.create({ data: { email, name: `Owner ${label}`, passwordHash } });
    await prisma.membership.create({ data: { workspaceId: ws.id, userId: user.id, role: opts.role ?? 'OWNER' } });
    workspaceIds.push(ws.id); userIds.push(user.id);
    const token = app.jwt.sign({ userId: user.id, workspaceId: ws.id, role: opts.role ?? 'OWNER' });
    return { workspaceId: ws.id, userId: user.id, email, token };
  }
  const A = await makeTenant('A');
  const B = await makeTenant('B');

  async function as(tenant: Tenant, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
    const raw = await app.inject({ method, url, headers: { authorization: `Bearer ${tenant.token}` }, ...(body !== undefined ? { payload: body as object } : {}) });
    let parsed: any = null;
    try { parsed = raw.body ? raw.json() : null; } catch { parsed = raw.body; }
    return { status: raw.statusCode, body: parsed, raw };
  }

  /** Cria um conjunto mínimo de recursos de todos os módulos no tenant informado. */
  async function fixtures(t: Tenant) {
    const s = randomBytes(3).toString('hex');
    const phone = `55119${Math.floor(10000000 + Math.random() * 89999999)}`;
    const contact = await prisma.contact.create({ data: { workspaceId: t.workspaceId, name: `Contato ${s}`, phone, email: `c-${s}@example.test`, ownerId: t.userId } });
    const tag = await prisma.tag.create({ data: { workspaceId: t.workspaceId, name: `tag-${s}` } });
    const channel = await prisma.channel.create({ data: { workspaceId: t.workspaceId, provider: 'baileys', displayName: `Canal ${s}`, phoneNumber: `55119${Math.floor(10000000 + Math.random() * 89999999)}`, status: 'CONNECTED' } });
    const playbook = await prisma.playbook.create({ data: { workspaceId: t.workspaceId, name: `Fluxo ${s}`, status: 'PUBLISHED' } });
    const version = await prisma.playbookVersion.create({ data: { playbookId: playbook.id, version: 1, definition: {}, checksum: `sum-${s}`, publishedAt: new Date(), createdById: t.userId } });
    await prisma.playbook.update({ where: { id: playbook.id }, data: { activeVersionId: version.id } });
    const conversation = await prisma.conversation.create({ data: { workspaceId: t.workspaceId, channelId: channel.id, contactId: contact.id, status: 'ASSIGNED', mode: 'HUMAN', assigneeId: t.userId, unreadCount: 3 } });
    const message = await prisma.message.create({ data: { workspaceId: t.workspaceId, conversationId: conversation.id, direction: 'INBOUND', type: 'TEXT', body: 'oi', authorType: 'contact', status: 'DELIVERED' } });
    const scheduled = await prisma.scheduledMessage.create({ data: { workspaceId: t.workspaceId, conversationId: conversation.id, authorId: t.userId, body: 'agendada', scheduledFor: new Date(Date.now() + 3600_000), jobId: `iso-${s}` } });
    const board = await prisma.kanbanBoard.create({ data: { workspaceId: t.workspaceId, name: `Quadro ${s}` } });
    const column = await prisma.kanbanColumn.create({ data: { boardId: board.id, name: 'Col 1', position: 0 } });
    const column2 = await prisma.kanbanColumn.create({ data: { boardId: board.id, name: 'Col 2', position: 1 } });
    const card = await prisma.kanbanCard.create({ data: { boardId: board.id, columnId: column.id, contactId: contact.id, conversationId: conversation.id, movedByType: 'user', movedById: t.userId } });
    return { contact, tag, channel, playbook, conversation, message, scheduled, board, column, column2, card };
  }

  async function teardown() {
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    await app.close();
  }

  return { app, prisma, A, B, as, fixtures, teardown };
}
