import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { hasTestDb, setupTwoTenants, type TwoTenants } from '../../test/two-tenants.js';
const RT = '../../../../runtime/src/';

// R-1 (A): disconnect do runtime à prova de falha, com socket falso cujo logout rejeita.
describe.skipIf(!hasTestDb)('runtime: disconnect(removeAuth) mesmo com logout falhando', () => {
  let t: TwoTenants; let sessions: any; let redis: any; let auth: { clear: ReturnType<typeof vi.fn>; load: ReturnType<typeof vi.fn> };
  beforeAll(async () => {
    t = await setupTwoTenants();
    redis = t.app.redis.duplicate({ maxRetriesPerRequest: null });
    const { WhatsAppSessionManager } = await import(/* @vite-ignore */ `${RT}whatsapp/session-manager.service.ts`);
    auth = { clear: vi.fn(async () => undefined), load: vi.fn(async () => ({ state: { creds: { registered: false } }, saveCreds: async () => undefined })) };
    sessions = new WhatsAppSessionManager(t.prisma as any, redis, auth as any);
  }, 60_000);
  afterAll(async () => { await sessions?.onModuleDestroy(); await redis?.quit(); await t?.teardown(); });
  const mkChannel = (extra: object = {}) => t.prisma.channel.create({ data: { workspaceId: t.A.workspaceId, provider: 'baileys', displayName: 'RT', phoneNumber: `5511${Math.floor(Math.random() * 1e9)}`, status: 'CONNECTED', externalPhoneId: `rt-${Math.random().toString(16).slice(2)}`, ...extra } });
  const live = (channelId: string, socket: object) => {
    const lease = { release: vi.fn(async () => undefined), renew: vi.fn(async () => true) };
    sessions.sessions.set(channelId, { socket, lease, renewTimer: setInterval(() => undefined, 1e6), manualClose: false });
    return lease;
  };

  it('logout rejeitando "Connection Closed": ainda derruba a sessão, limpa credenciais, marca DISCONNECTED e limpa o Redis', async () => {
    const ch = await mkChannel(); auth.clear.mockClear();
    const socket = { logout: vi.fn(async () => { throw new Error('Connection Closed'); }), end: vi.fn() };
    const lease = live(ch.id, socket);
    await expect(sessions.disconnect(ch.id, true)).resolves.not.toThrow();
    expect(socket.logout).toHaveBeenCalledTimes(1);
    expect(lease.release).toHaveBeenCalled();
    expect(sessions.sessions.has(ch.id)).toBe(false);
    expect(auth.clear).toHaveBeenCalledWith(ch.id);
    const row = await t.prisma.channel.findUniqueOrThrow({ where: { id: ch.id } });
    expect(row.status).toBe('DISCONNECTED'); expect(row.externalPhoneId).toBeNull();
    const state = JSON.parse((await redis.get(`wa:session:${ch.id}`))!);
    expect(state.status).toBe('DISCONNECTED'); expect(state.unlinkFailed).toBe(true);
  });

  it('logout ok: unlinkFailed fica falso', async () => {
    const ch = await mkChannel(); auth.clear.mockClear();
    live(ch.id, { logout: vi.fn(async () => undefined), end: vi.fn() });
    await sessions.disconnect(ch.id, true);
    expect(auth.clear).toHaveBeenCalledWith(ch.id);
    expect(JSON.parse((await redis.get(`wa:session:${ch.id}`))!).unlinkFailed).toBe(false);
  });

  it('sem removeAuth: só encerra, mantém credenciais', async () => {
    const ch = await mkChannel(); auth.clear.mockClear();
    const socket = { logout: vi.fn(), end: vi.fn() };
    live(ch.id, socket);
    await sessions.disconnect(ch.id, false);
    expect(socket.logout).not.toHaveBeenCalled(); expect(socket.end).toHaveBeenCalled(); expect(auth.clear).not.toHaveBeenCalled();
    expect((await t.prisma.channel.findUniqueOrThrow({ where: { id: ch.id } })).status).toBe('DISCONNECTED');
  });

  it('sem sessão viva (runtime reiniciado) e removeAuth: tenta desvincular com as credenciais salvas; se falhar, limpa local e sinaliza', async () => {
    const ch = await mkChannel(); auth.clear.mockClear();
    const spy = vi.spyOn(sessions, 'unlinkStoredDevice').mockRejectedValue(new Error('rede fora'));
    await expect(sessions.disconnect(ch.id, true)).resolves.not.toThrow();
    expect(spy).toHaveBeenCalledWith(ch.id);
    expect(auth.clear).toHaveBeenCalledWith(ch.id);
    expect((await t.prisma.channel.findUniqueOrThrow({ where: { id: ch.id } })).status).toBe('DISCONNECTED');
    expect(JSON.parse((await redis.get(`wa:session:${ch.id}`))!).unlinkFailed).toBe(true);
    spy.mockRestore();
  });

  it('unlinkStoredDevice sem pareamento salvo (registered=false): nada a desvincular, sem abrir socket', async () => {
    const ch = await mkChannel();
    expect(await sessions.unlinkStoredDevice(ch.id)).toBe(true);
  });
});
