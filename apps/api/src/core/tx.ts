/**
 * Repetição de transações que o Postgres aborta sem conflito lógico real (SSI Serializable, deadlock).
 * Repete SOMENTE P2034 (Prisma), SQLSTATE 40001 (serialization_failure) e 40P01 (deadlock_detected).
 * A função inteira (a transação toda) é reexecutada; esgotadas as tentativas, relança o erro ORIGINAL
 * (core/errors.ts responde 503 TRY_AGAIN para esses códigos).
 */
type Logger = { warn: (obj: Record<string, unknown>, msg?: string) => void };

export type RetrySerializableOptions = {
  attempts?: number;
  /** Base do backoff em ms; o atraso é base + aleatório em [0, base * tentativa * 2). */
  backoffMs?: number;
  log?: Logger;
  label?: string;
  sleep?: (ms: number) => Promise<unknown>;
  random?: () => number;
};

const RETRYABLE_SQLSTATE = new Set(['40001', '40P01']);

export function isRetryableTxError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > 3) return false;
  const e = error as { code?: unknown; meta?: { code?: unknown; message?: unknown }; message?: unknown; cause?: unknown };
  if (e.code === 'P2034') return true;
  if (typeof e.code === 'string' && RETRYABLE_SQLSTATE.has(e.code)) return true;
  if (typeof e.meta?.code === 'string' && RETRYABLE_SQLSTATE.has(e.meta.code)) return true;
  if (e.code === 'P2010' || e.code === 'P2028' || e.code === undefined) {
    const text = `${String(e.message ?? '')} ${String(e.meta?.message ?? '')}`;
    if (/could not serialize access|deadlock detected|SQLSTATE\W*(40001|40P01)|\b(40001|40P01)\b/i.test(text)) return true;
  }
  return e.cause !== undefined && isRetryableTxError(e.cause, depth + 1);
}

export async function retrySerializable<T>(fn: () => Promise<T>, options: RetrySerializableOptions = {}): Promise<T> {
  const { attempts = 5, backoffMs = 25, log, label, sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms)), random = Math.random } = options;
  for (let attempt = 1; ; attempt += 1) {
    try { return await fn(); }
    catch (error) {
      if (attempt >= attempts || !isRetryableTxError(error)) throw error;
      const delay = backoffMs + Math.floor(random() * backoffMs * attempt * 2);
      log?.warn({ attempt, attempts, delayMs: delay, label, code: (error as { code?: unknown }).code }, 'transaction aborted by the database, retrying');
      await sleep(delay);
    }
  }
}
