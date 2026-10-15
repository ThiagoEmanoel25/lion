import { describe, expect, it } from 'vitest';
import { conditionMatches, getPathValue, systemContext } from './conditions.js';
import { AutomationEdgeConditionSchema } from './index.js';

describe('conditionMatches', () => {
  it('mantém os operadores existentes', () => {
    expect(conditionMatches('Ana', { operator: 'equals', value: 'Ana' })).toBe(true);
    expect(conditionMatches(['vip'], { operator: 'contains', value: 'vip' })).toBe(true);
    expect(conditionMatches(undefined, { operator: 'not_exists' })).toBe(true);
    expect(conditionMatches(80, { operator: 'greater_than', value: 50 })).toBe(true);
  });

  it('compara texto com texto em maior/menor (datas e horários ISO)', () => {
    expect(conditionMatches('2026-10-15', { operator: 'greater_than', value: '2026-10-01' })).toBe(true);
    expect(conditionMatches('2026-10-15', { operator: 'less_than', value: '2026-10-01' })).toBe(false);
    expect(conditionMatches('10', { operator: 'greater_than', value: 5 })).toBe(false);
  });

  it('in/not_in aceitam valor simples ou lista (interseção)', () => {
    expect(conditionMatches(3, { operator: 'in', value: [1, 2, 3] })).toBe(true);
    expect(conditionMatches(['t1', 't9'], { operator: 'in', value: ['t9'] })).toBe(true);
    expect(conditionMatches(['t1'], { operator: 'not_in', value: ['t9'] })).toBe(true);
    expect(conditionMatches(['t1', 't9'], { operator: 'not_in', value: ['t9'] })).toBe(false);
    expect(conditionMatches('x', { operator: 'in', value: 'x' })).toBe(false);
  });

  it('between é inclusivo e dá a volta quando início > fim', () => {
    expect(conditionMatches('08:00', { operator: 'between', value: ['08:00', '18:00'] })).toBe(true);
    expect(conditionMatches('18:01', { operator: 'between', value: ['08:00', '18:00'] })).toBe(false);
    expect(conditionMatches('23:30', { operator: 'between', value: ['22:00', '06:00'] })).toBe(true);
    expect(conditionMatches('05:59', { operator: 'between', value: ['22:00', '06:00'] })).toBe(true);
    expect(conditionMatches('12:00', { operator: 'between', value: ['22:00', '06:00'] })).toBe(false);
    expect(conditionMatches('12:00', { operator: 'not_between', value: ['22:00', '06:00'] })).toBe(true);
    expect(conditionMatches('12:00', { operator: 'between', value: ['08:00'] })).toBe(false);
  });
});

describe('getPathValue', () => {
  it('resolve caminhos aninhados', () => {
    expect(getPathValue({ contact: { customFields: { plano: 'pro' } } }, 'contact.customFields.plano')).toBe('pro');
    expect(getPathValue({ contact: null }, 'contact.name')).toBeUndefined();
  });
});

describe('systemContext', () => {
  it('usa o fuso do workspace', () => {
    // 02:30 UTC de 15/10/2026 = 23:30 de quarta, 14/10, em America/Bahia (UTC-3)
    expect(systemContext(new Date('2026-10-15T02:30:00Z'), 'America/Bahia')).toEqual({ weekday: 3, time: '23:30', date: '2026-10-14' });
  });

  it('cai em UTC quando o fuso é inválido', () => {
    expect(systemContext(new Date('2026-10-15T02:30:00Z'), 'Not/AZone')).toEqual({ weekday: 4, time: '02:30', date: '2026-10-15' });
  });
});

describe('AutomationEdgeConditionSchema', () => {
  it('exige lista em in/not_in e par em between', () => {
    expect(AutomationEdgeConditionSchema.safeParse({ field: 'system.weekday', operator: 'in', value: [] }).success).toBe(false);
    expect(AutomationEdgeConditionSchema.safeParse({ field: 'system.time', operator: 'between', value: ['08:00'] }).success).toBe(false);
    expect(AutomationEdgeConditionSchema.safeParse({ field: 'system.time', operator: 'between', value: ['08:00', '18:00'] }).success).toBe(true);
  });
});
