import { describe, expect, it } from 'vitest';
import { buildDailySeries, percentageChange, ratio, startOfUtcDay } from './metrics.js';

describe('analytics metrics', () => {
  it('calcula proporções e variação sem dividir por zero', () => {
    expect(ratio(3, 4)).toBe(.75);
    expect(ratio(3, 0)).toBe(0);
    expect(percentageChange(12, 10)).toBeCloseTo(.2);
    expect(percentageChange(1, 0)).toBeNull();
    expect(percentageChange(0, 0)).toBe(0);
  });

  it('preenche dias sem movimento e agrupa eventos', () => {
    const from = new Date('2026-10-12T00:00:00.000Z');
    const result = buildDailySeries(from, 3, [
      { createdAt: new Date('2026-10-12T10:00:00Z'), resolvedAt: new Date('2026-10-13T08:00:00Z') }
    ], [{ occurredAt: new Date('2026-10-13T09:00:00Z') }]);
    expect(result).toEqual([
      { date: '2026-10-12', conversations: 1, outcomes: 0, resolved: 0 },
      { date: '2026-10-13', conversations: 0, outcomes: 1, resolved: 1 },
      { date: '2026-10-14', conversations: 0, outcomes: 0, resolved: 0 }
    ]);
    expect(startOfUtcDay(new Date('2026-10-14T18:30:00Z')).toISOString()).toBe('2026-10-14T00:00:00.000Z');
  });
});
