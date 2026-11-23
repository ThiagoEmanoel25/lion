export const ratio = (part: number, total: number) => total > 0 ? part / total : 0;

export const percentageChange = (current: number, previous: number): number | null => {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
};

export type DailyPoint = { date: string; conversations: number; outcomes: number; resolved: number };

const validZone = (timeZone: string) => { try { new Intl.DateTimeFormat('en-US', { timeZone }); return timeZone; } catch { return 'UTC'; } };

// Dia (AAAA-MM-DD) de um instante no fuso informado; fuso inválido cai no UTC.
export const zonedDayKey = (date: Date, timeZone = 'UTC') => new Intl.DateTimeFormat('en-CA', { timeZone: validZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

export const shiftDayKey = (key: string, days: number) => {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

// Instante em que o dia local `key` começa no fuso informado.
export function startOfZonedDayKey(key: string, timeZone = 'UTC'): Date {
  const zone = validZone(timeZone);
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d);
  const format = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(format.formatToParts(new Date(guess)).map(part => [part.type, Number(part.value)]));
    const local = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
    guess = wall - (local - Math.floor(guess / 1000) * 1000);
  }
  return new Date(guess);
}

export function buildDailySeries(from: Date, days: number, conversations: Array<{ createdAt: Date; resolvedAt: Date | null }>, outcomes: Array<{ occurredAt: Date }>, timeZone = 'UTC'): DailyPoint[] {
  const points = new Map<string, DailyPoint>();
  const firstKey = zonedDayKey(from, timeZone);
  const dayKey = (date: Date) => zonedDayKey(date, timeZone);
  for (let index = 0; index < days; index++) {
    const key = shiftDayKey(firstKey, index);
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

export type HourPoint = { hour: number; conversations: number };

// Distribuição por hora do dia, no fuso do workspace: saber que o movimento chega às 20h só
// serve se "20h" for a hora de quem atende, não UTC. Fuso inválido cai no UTC em vez de quebrar.
export function buildHourSeries(conversations: Array<{ createdAt: Date }>, timeZone: string): HourPoint[] {
  const points: HourPoint[] = Array.from({ length: 24 }, (_, hour) => ({ hour, conversations: 0 }));
  let format: Intl.DateTimeFormat;
  try { format = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hour12: false }); }
  catch { format = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: '2-digit', hour12: false }); }
  for (const conversation of conversations) {
    // "24" aparece à meia-noite em alguns runtimes.
    const hour = Number(format.format(conversation.createdAt)) % 24;
    if (Number.isInteger(hour) && hour >= 0 && hour < 24) points[hour]!.conversations++;
  }
  return points;
}
