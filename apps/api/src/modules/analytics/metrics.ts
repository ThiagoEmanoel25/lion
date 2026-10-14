export const ratio = (part: number, total: number) => total > 0 ? part / total : 0;

export const percentageChange = (current: number, previous: number): number | null => {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
};

export type DailyPoint = { date: string; conversations: number; outcomes: number; resolved: number };

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

export function buildDailySeries(from: Date, days: number, conversations: Array<{ createdAt: Date; resolvedAt: Date | null }>, outcomes: Array<{ occurredAt: Date }>): DailyPoint[] {
  const points = new Map<string, DailyPoint>();
  for (let index = 0; index < days; index++) {
    const date = new Date(from);
    date.setUTCDate(date.getUTCDate() + index);
    const key = dayKey(date);
    points.set(key, { date: key, conversations: 0, outcomes: 0, resolved: 0 });
  }
  for (const conversation of conversations) {
    const created = points.get(dayKey(conversation.createdAt));
    if (created) created.conversations++;
    if (conversation.resolvedAt) {
      const resolved = points.get(dayKey(conversation.resolvedAt));
      if (resolved) resolved.resolved++;
    }
  }
  for (const outcome of outcomes) {
    const point = points.get(dayKey(outcome.occurredAt));
    if (point) point.outcomes++;
  }
  return [...points.values()];
}

export function startOfUtcDay(date: Date) {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}
