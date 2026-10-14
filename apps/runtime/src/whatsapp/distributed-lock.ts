import { randomUUID } from 'node:crypto';
import { RedisService } from '../infra/redis.service.js';

const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
const RENEW = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;

export type LockLease = { renew(): Promise<boolean>; release(): Promise<void> };

export async function acquireLock(redis: RedisService, key: string, ttlMs = 45_000): Promise<LockLease | null> {
  const token = randomUUID();
  const acquired = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (acquired !== 'OK') return null;
  return {
    renew: async () => (await redis.eval(RENEW, 1, key, token, String(ttlMs))) === 1,
    release: async () => { await redis.eval(RELEASE, 1, key, token); }
  };
}
