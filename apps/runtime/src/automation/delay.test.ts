import { describe, expect, it } from 'vitest';
import { planDelay } from './delay.js';

const now = new Date('2026-10-24T15:00:00.000Z'); // Saturday 12:00 in America/Bahia

describe('planDelay', () => {
  it('config legada {seconds} continua valendo como duração', () => {
    const plan = planDelay({ seconds: 300, unit: 'minutes' }, now, 'America/Bahia');
    expect(plan).toMatchObject({ mode: 'duration', delayMs: 300_000, scheduledFor: '2026-10-24T15:05:00.000Z' });
  });
  it('data usa o instante calculado e data passada continua já', () => {
    expect(planDelay({ mode: 'date', runAt: '2026-10-25T14:00:00-03:00' }, now, 'America/Bahia')).toMatchObject({ mode: 'date', scheduledFor: '2026-10-25T17:00:00.000Z', delayMs: 93_600_000 });
    expect(planDelay({ mode: 'date', runAt: '2026-10-01T00:00:00Z' }, now, 'America/Bahia').delayMs).toBe(0);
  });
  it('horários executados no sábado retomam segunda 09:00 no fuso do workspace', () => {
    const days = [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, enabled: day >= 1 && day <= 5, start: '09:00', end: '18:00' }));
    const plan = planDelay({ mode: 'schedule', days }, now, 'America/Bahia');
    expect(plan).toMatchObject({ mode: 'schedule', scheduledFor: '2026-10-26T12:00:00.000Z' });
    expect(plan.delayMs).toBe(plan.at.getTime() - now.getTime());
  });
  it('config inválida lança com a mensagem do domínio', () => {
    expect(() => planDelay({ seconds: 0 }, now, 'America/Bahia')).toThrow('entre 1 segundo e 31 dias');
  });
});
