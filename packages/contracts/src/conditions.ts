// Pure rule evaluation shared by the API (validation/simulation) and the runtime.
export const CONDITION_OPERATORS = ['equals', 'not_equals', 'contains', 'not_contains', 'exists', 'not_exists', 'greater_than', 'less_than', 'in', 'not_in', 'between', 'not_between'] as const;
export type ConditionOperator = typeof CONDITION_OPERATORS[number];

export function getPathValue(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => current && typeof current === 'object'
    ? (current as Record<string, unknown>)[part]
    : undefined, source);
}

// Ordering only makes sense between two numbers or two strings (ISO dates, HH:MM).
const comparable = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string');

function within(value: unknown, range: unknown): boolean {
  if (!Array.isArray(range) || range.length !== 2) return false;
  const [from, to] = range as [unknown, unknown];
  if (!comparable(value, from) || !comparable(value, to)) return false;
  const v = value as string, a = from as string, b = to as string;
  // from > to wraps around, e.g. 22:00–06:00 crosses midnight.
  return a <= b ? v >= a && v <= b : v >= a || v <= b;
}

function intersects(value: unknown, expected: unknown): boolean {
  if (!Array.isArray(expected)) return false;
  return Array.isArray(value) ? value.some(item => expected.includes(item)) : expected.includes(value);
}

export function conditionMatches(value: unknown, rule: { operator: ConditionOperator; value?: unknown }): boolean {
  const expected = rule.value;
  switch (rule.operator) {
    case 'equals': return value === expected;
    case 'not_equals': return value !== expected;
    case 'contains': return Array.isArray(value) ? value.includes(expected) : typeof value === 'string' && value.includes(String(expected));
    case 'not_contains': return Array.isArray(value) ? !value.includes(expected) : typeof value !== 'string' || !value.includes(String(expected));
    case 'exists': return value !== undefined && value !== null;
    case 'not_exists': return value === undefined || value === null;
    case 'greater_than': return comparable(value, expected) && (value as string) > (expected as string);
    case 'less_than': return comparable(value, expected) && (value as string) < (expected as string);
    case 'in': return intersects(value, expected);
    case 'not_in': return Array.isArray(expected) && !intersects(value, expected);
    case 'between': return within(value, expected);
    case 'not_between': return Array.isArray(expected) && expected.length === 2 && !within(value, expected);
  }
}

export type SystemContext = { weekday: number; time: string; date: string };
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function systemContext(now: Date, timeZone: string): SystemContext {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  } catch {
    return systemContext(now, 'UTC');
  }
  const parts = Object.fromEntries(format.formatToParts(now).map(part => [part.type, part.value]));
  return { weekday: WEEKDAYS[parts.weekday ?? ''] ?? 0, time: `${parts.hour}:${parts.minute}`, date: `${parts.year}-${parts.month}-${parts.day}` };
}
