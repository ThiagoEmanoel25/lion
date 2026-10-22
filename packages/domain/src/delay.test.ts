import { describe, expect, it } from 'vitest';
import { delayConfigIssue, nextDelayAt, normalizeDelayConfig, type DelayConfig } from './delay.js';

const TZ = 'America/Bahia';
const day = (d: number, start = '09:00', end = '18:00') => ({ day: d, enabled: true, start, end });
const weekdays: DelayConfig = { mode: 'schedule', days: [1, 2, 3, 4, 5].map(d => day(d)) };

describe('delay', () => {
  it('normalizes legacy configs', () => {
    expect(normalizeDelayConfig({ seconds: 300 })).toEqual({ mode: 'duration', duration: 300, unit: 'seconds' });
    expect(normalizeDelayConfig({ seconds: 2_678_400, unit: 'days' })).toEqual({ mode: 'duration', duration: 2_678_400, unit: 'seconds' });
    expect(normalizeDelayConfig({ duration: 5, unit: 'minutes' })).toEqual({ mode: 'duration', duration: 5, unit: 'minutes' });
  });
  it('duration adds the interval and enforces 1s..31d', () => {
    const now = new Date('2026-10-22T12:00:00Z');
    expect(nextDelayAt({ mode: 'duration', duration: 5, unit: 'minutes' }, now, TZ).at.toISOString()).toBe('2026-10-22T12:05:00.000Z');
    expect(() => nextDelayAt({ mode: 'duration', duration: 32, unit: 'days' }, now, TZ)).toThrow();
    expect(() => nextDelayAt({ mode: 'duration', duration: 0, unit: 'seconds' }, now, TZ)).toThrow();
  });
  it('date: past continues now, future waits, >365d rejected', () => {
    const now = new Date('2026-10-22T12:00:00Z');
    expect(nextDelayAt({ mode: 'date', runAt: '2026-10-20T10:00:00-03:00' }, now, TZ).at).toEqual(now);
    expect(nextDelayAt({ mode: 'date', runAt: '2026-10-25T14:00:00-03:00' }, now, TZ).at.toISOString()).toBe('2026-10-25T17:00:00.000Z');
    expect(() => nextDelayAt({ mode: 'date', runAt: '2027-10-23T00:00:00Z' }, now, TZ)).toThrow(/365/);
    expect(() => nextDelayAt({ mode: 'date', runAt: '2026-10-25T14:00:00' }, now, TZ)).toThrow();
  });
  it('schedule: saturday -> monday 09:00 local', () => {
    expect(nextDelayAt(weekdays, new Date('2026-10-24T13:00:00Z'), TZ).at.toISOString()).toBe('2026-10-26T12:00:00.000Z');
  });
  it('schedule: inside the range continues now', () => {
    const mon = new Date('2026-10-26T15:00:00Z');
    expect(nextDelayAt(weekdays, mon, TZ).at).toEqual(mon);
  });
  it('schedule: before the range waits for today start; after the range goes to next day', () => {
    expect(nextDelayAt(weekdays, new Date('2026-10-26T10:00:00Z'), TZ).at.toISOString()).toBe('2026-10-26T12:00:00.000Z');
    expect(nextDelayAt(weekdays, new Date('2026-10-26T22:00:00Z'), TZ).at.toISOString()).toBe('2026-10-27T12:00:00.000Z');
  });
  it('schedule: week wrap with only sunday active, and config timezone wins', () => {
    const sun: DelayConfig = { mode: 'schedule', days: [day(0)] };
    expect(nextDelayAt(sun, new Date('2026-10-28T15:00:00Z'), TZ).at.toISOString()).toBe('2026-11-01T12:00:00.000Z');
    expect(nextDelayAt({ ...sun, timezone: 'UTC' } as DelayConfig, new Date('2026-10-28T15:00:00Z'), TZ).at.toISOString()).toBe('2026-11-01T09:00:00.000Z');
  });
  it('schedule: DST zone resolves local wall time (New York, after fall back)', () => {
    const ny: DelayConfig = { mode: 'schedule', timezone: 'America/New_York', days: [day(1)] };
    expect(nextDelayAt(ny, new Date('2026-11-01T12:00:00Z'), TZ).at.toISOString()).toBe('2026-11-02T14:00:00.000Z');
    expect(nextDelayAt(ny, new Date('2026-10-31T12:00:00Z'), TZ).at.toISOString()).toBe('2026-11-02T14:00:00.000Z');
  });
  it('schedule validation', () => {
    expect(delayConfigIssue({ mode: 'schedule', days: [{ ...day(1), enabled: false }] })).toMatch(/ao menos um dia/);
    expect(delayConfigIssue({ mode: 'schedule', days: [day(1, '18:00', '09:00')] })).toMatch(/meia-noite/);
    expect(delayConfigIssue({ mode: 'schedule', days: [day(1, '22:00', '06:00')] })).toMatch(/meia-noite/);
    expect(delayConfigIssue({ mode: 'schedule', days: [day(1, '09:00', '09:00')] })).toMatch(/antes do fim/);
    expect(() => nextDelayAt({ mode: 'schedule', days: [] }, new Date(), TZ)).toThrow();
  });
  it('schedule timezone validation', () => {
    expect(delayConfigIssue({ mode: 'schedule', timezone: 'Foo/Bar', days: [day(1)] })).toMatch(/Fuso horário inválido: Foo\/Bar/);
    expect(() => nextDelayAt({ mode: 'schedule', timezone: 'Foo/Bar', days: [day(1)] }, new Date(), TZ)).toThrow(/Foo\/Bar/);
    expect(delayConfigIssue({ mode: 'schedule', timezone: 'America/Sao_Paulo', days: [day(1)] })).toBeNull();
  });
});
