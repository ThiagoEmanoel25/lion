import { describe, expect, it } from 'vitest';
import { delayConfigOf, delaySummary, isoToLocal, localToIso, delayCfgError, defaultScheduleDays } from './delay-config';

describe('delay-config', () => {
  it('abre config legada com a maior unidade exata', () => {
    expect(delayConfigOf({ seconds: 172800, unit: 'days' })).toEqual({ mode: 'duration', duration: 2, unit: 'days' });
    expect(delayConfigOf({ seconds: 90 })).toEqual({ mode: 'duration', duration: 90, unit: 'seconds' });
    expect(delayConfigOf({ seconds: 5400, unit: 'hours' })).toEqual({ mode: 'duration', duration: 90, unit: 'minutes' });
    expect(delayConfigOf({ mode: 'duration', duration: 5, unit: 'minutes' })).toEqual({ mode: 'duration', duration: 5, unit: 'minutes' });
  });
  it('resume os três modos para o canvas', () => {
    expect(delaySummary({ seconds: 300 })).toBe('Espera de 5 minutos');
    expect(delaySummary({ mode: 'duration', duration: 1, unit: 'hours' })).toBe('Espera de 1 hora');
    expect(delaySummary({ mode: 'date', runAt: '2026-10-25T14:00:00-03:00' })).toBe('Até 25/10 14:00');
    expect(delaySummary({ mode: 'schedule', days: defaultScheduleDays() })).toBe('Seg–Sex 09:00–18:00');
    const days = defaultScheduleDays().map(d => d.day === 6 ? { ...d, enabled: true, end: '12:00' } : d);
    expect(delaySummary({ mode: 'schedule', days })).toBe('Seg–Sex 09:00–18:00 · Sáb 09:00–12:00');
  });
  it('converte datetime-local de/para ISO com o offset do fuso', () => {
    expect(localToIso('2026-10-25T14:00', 'America/Bahia')).toBe('2026-10-25T14:00:00-03:00');
    expect(localToIso('2026-07-01T10:30', 'Europe/Lisbon')).toBe('2026-07-01T10:30:00+01:00');
    expect(isoToLocal('2026-10-25T17:00:00Z', 'America/Bahia')).toBe('2026-10-25T14:00');
  });
  it('avisa quando nenhum dia está ligado', () => {
    expect(delayCfgError({ mode: 'schedule', days: defaultScheduleDays().map(d => ({ ...d, enabled: false })) })).toBe('Ative ao menos um dia da semana');
    expect(delayCfgError({ mode: 'schedule', days: defaultScheduleDays() })).toBe('');
  });
});
