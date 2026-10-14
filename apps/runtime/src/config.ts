import { createHash } from 'node:crypto';

export type RuntimeConfig = {
  databaseUrl: string;
  redisUrl: string;
  encryptionKey: Buffer;
  logLevel: string;
};

function encryptionKey(value: string | undefined): Buffer {
  if (!value) throw new Error('FIELD_ENCRYPTION_KEY is required');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 32) return decoded;
  if (process.env.NODE_ENV !== 'production' && value.startsWith('replace-with-')) {
    return createHash('sha256').update(value).digest();
  }
  throw new Error('FIELD_ENCRYPTION_KEY must be a base64 encoded 32-byte key');
}

export function loadConfig(): RuntimeConfig {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!redisUrl) throw new Error('REDIS_URL is required');
  return {
    databaseUrl,
    redisUrl,
    encryptionKey: encryptionKey(process.env.FIELD_ENCRYPTION_KEY),
    logLevel: process.env.LOG_LEVEL ?? 'info'
  };
}
