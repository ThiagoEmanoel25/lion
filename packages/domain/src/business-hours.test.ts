import { describe, expect, it } from 'vitest';
import { isWithinBusinessHours, type BusinessHoursConfig } from './business-hours.js';

const TZ = 'America/Sao_Paulo'; // UTC-3 o ano todo (sem horário de verão desde 2019)
const week = (over: Record<number, Partial<{ enabled: boolean; open: string; close: string }>> = {}): BusinessHoursConfig => ({
  days: [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, enabled: day >= 1 && day <= 5, open: '08:00', close: '18:00', ...over[day] }))
});
// 2026-11-23 é segunda-feira
const at = (iso: string) => new Date(iso);

describe('isWithinBusinessHours', () => {
  it('dentro, antes e depois da faixa (abertura inclusive, fechamento exclusivo)', () => {
    expect(isWithinBusinessHours(week(), at('2026-11-23T11:00:00Z'), TZ)).toBe(true); // 08:00 local
    expect(isWithinBusinessHours(week(), at('2026-11-23T10:59:00Z'), TZ)).toBe(false); // 07:59
    expect(isWithinBusinessHours(week(), at('2026-11-23T20:59:00Z'), TZ)).toBe(true); // 17:59
    expect(isWithinBusinessHours(week(), at('2026-11-23T21:00:00Z'), TZ)).toBe(false); // 18:00
  });
  it('virada de dia pelo fuso: 01:00Z de terça ainda é segunda à noite em São Paulo', () => {
    expect(isWithinBusinessHours(week({ 1: { close: '23:00' } }), at('2026-11-24T01:00:00Z'), TZ)).toBe(true); // seg 22:00
    expect(isWithinBusinessHours(week(), at('2026-11-24T01:00:00Z'), TZ)).toBe(false);
  });
  it('dia desligado fica fechado; fim de semana padrão fechado', () => {
    expect(isWithinBusinessHours(week(), at('2026-11-28T15:00:00Z'), TZ)).toBe(false); // sábado 12:00
    expect(isWithinBusinessHours(week({ 6: { enabled: true } }), at('2026-11-28T15:00:00Z'), TZ)).toBe(true);
    expect(isWithinBusinessHours(week({ 1: { enabled: false } }), at('2026-11-23T15:00:00Z'), TZ)).toBe(false);
  });
  it('faixa que cruza a meia-noite pertence ao dia de abertura', () => {
    const night = week({ 5: { open: '22:00', close: '02:00' } }); // sexta 22:00 até sábado 02:00
    expect(isWithinBusinessHours(night, at('2026-11-28T01:00:00Z'), TZ)).toBe(true); // sex 22:00
    expect(isWithinBusinessHours(night, at('2026-11-28T04:00:00Z'), TZ)).toBe(true); // sáb 01:00
    expect(isWithinBusinessHours(night, at('2026-11-28T05:00:00Z'), TZ)).toBe(false); // sáb 02:00
    expect(isWithinBusinessHours(night, at('2026-11-27T20:00:00Z'), TZ)).toBe(false); // sex 17:00 (antes de abrir)
    expect(isWithinBusinessHours(week({ 5: { open: '22:00', close: '02:00', enabled: false } }), at('2026-11-28T04:00:00Z'), TZ)).toBe(false);
  });
  it('domingo vira sábado ao cruzar a meia-noite (dia anterior de domingo é sábado)', () => {
    const cfg = week({ 6: { enabled: true, open: '22:00', close: '03:00' } });
    expect(isWithinBusinessHours(cfg, at('2026-11-29T04:00:00Z'), TZ)).toBe(true); // dom 01:00
  });
  it('fuso diferente muda o resultado para o mesmo instante', () => {
    const instant = at('2026-11-23T12:00:00Z'); // seg 09:00 SP, 21:00 Tóquio, 04:00 Los Angeles
    expect(isWithinBusinessHours(week(), instant, 'America/Sao_Paulo')).toBe(true);
    expect(isWithinBusinessHours(week(), instant, 'Asia/Tokyo')).toBe(false);
    expect(isWithinBusinessHours(week(), instant, 'America/Los_Angeles')).toBe(false);
  });
  it('horário de verão: o mesmo horário local de parede em New York', () => {
    const cfg = week();
    expect(isWithinBusinessHours(cfg, at('2026-07-06T12:00:00Z'), 'America/New_York')).toBe(true); // verão: 08:00 local
    expect(isWithinBusinessHours(cfg, at('2026-07-06T11:59:00Z'), 'America/New_York')).toBe(false); // 07:59
    expect(isWithinBusinessHours(cfg, at('2026-12-07T13:00:00Z'), 'America/New_York')).toBe(true); // inverno: 08:00 local
    expect(isWithinBusinessHours(cfg, at('2026-12-07T12:59:00Z'), 'America/New_York')).toBe(false);
  });
  it('configuração ou fuso inválidos tratam como aberto; faixa vazia fica fechada', () => {
    expect(isWithinBusinessHours(null, at('2026-11-23T05:00:00Z'), TZ)).toBe(true);
    expect(isWithinBusinessHours(week(), at('2026-11-23T05:00:00Z'), 'Mars/Phobos')).toBe(true);
    expect(isWithinBusinessHours(week({ 1: { open: '09:00', close: '09:00' } }), at('2026-11-23T12:00:00Z'), TZ)).toBe(false);
  });
});
