import { describe, expect, it, vi } from 'vitest';
import { isRetryableTxError, retrySerializable } from './tx.js';

const err = (code: string, extra: object = {}) => Object.assign(new Error(code), { code, ...extra });
const opts = (extra: object = {}) => ({ sleep: vi.fn(async () => undefined), random: () => 0.5, ...extra });

describe('retrySerializable', () => {
  it.each([['P2034'], ['40001'], ['40P01']])('repete em %s e devolve o sucesso', async code => {
    const fn = vi.fn().mockRejectedValueOnce(err(code)).mockResolvedValue('ok');
    expect(await retrySerializable(fn, opts())).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('reconhece SQLSTATE dentro de meta.code (P2010) e na mensagem do Postgres', () => {
    expect(isRetryableTxError(err('P2010', { meta: { code: '40001' } }))).toBe(true);
    expect(isRetryableTxError(new Error('could not serialize access due to read/write dependencies among transactions'))).toBe(true);
    expect(isRetryableTxError(new Error('deadlock detected'))).toBe(true);
  });
  it.each([['P2002'], ['P2025'], ['23505'], ['X']])('não repete em %s', async code => {
    const fn = vi.fn().mockRejectedValue(err(code));
    await expect(retrySerializable(fn, opts())).rejects.toMatchObject({ code });
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('não repete erros sem código nem não-erros', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(retrySerializable(fn, opts())).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(isRetryableTxError(null)).toBe(false);
  });
  it('respeita o limite e relança o erro original', async () => {
    const original = err('P2034');
    const fn = vi.fn().mockRejectedValue(original);
    await expect(retrySerializable(fn, opts({ attempts: 3 }))).rejects.toBe(original);
    expect(fn).toHaveBeenCalledTimes(3);
  });
  it('registra warn por tentativa repetida e aplica backoff com jitter', async () => {
    const warn = vi.fn(); const sleep = vi.fn(async () => undefined);
    const values = [0, 0.999, 0.3]; let i = 0;
    const fn = vi.fn().mockRejectedValue(err('40001'));
    await expect(retrySerializable(fn, { attempts: 4, backoffMs: 10, log: { warn }, sleep, random: () => values[i++ % 3]! })).rejects.toBeDefined();
    expect(warn).toHaveBeenCalledTimes(3);
    const delays = sleep.mock.calls.map(c => (c as unknown as [number])[0]);
    expect(delays[0]).toBe(10);
    expect(delays[1]).toBe(10 + Math.floor(0.999 * 10 * 2 * 2));
    expect(delays[2]).toBe(10 + Math.floor(0.3 * 10 * 3 * 2));
    expect(delays.every(d => d >= 10)).toBe(true);
  });
  it('reexecuta a função inteira a cada tentativa', async () => {
    let runs = 0;
    const result = await retrySerializable(async () => { runs += 1; if (runs < 3) throw err('P2034'); return runs; }, opts());
    expect(result).toBe(3);
  });
});
