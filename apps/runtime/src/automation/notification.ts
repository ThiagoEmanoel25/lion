export const NOTIFICATION_HOURLY_LIMIT = 30;
export const NOTIFICATION_RATE_WINDOW_MS = 60 * 60 * 1_000;

export type NotificationLimitDecision = Readonly<{
  allowed: boolean;
  used: number;
  remaining: number;
}>;

/**
 * Converts a phone with an international dialing code to canonical E.164.
 * It accepts common visual separators and the international `00` prefix.
 */
export function normalizeE164(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const international = trimmed.startsWith('00') ? `+${trimmed.slice(2)}` : trimmed;
  const compact = international.replace(/[\s().-]/g, '');
  const withPlus = compact.startsWith('+') ? compact : `+${compact}`;
  if (!/^\+[1-9]\d{7,14}$/.test(withPlus)) return null;
  return withPlus;
}

export function isE164(value: string): boolean {
  return normalizeE164(value) === value;
}

/** Pure quota decision; only accepted notifications should be counted by the caller. */
export function decideNotificationLimit(
  acceptedInWindow: number,
  limit = NOTIFICATION_HOURLY_LIMIT
): NotificationLimitDecision {
  if (!Number.isSafeInteger(acceptedInWindow) || acceptedInWindow < 0) throw new Error('NOTIFICATION_COUNT_INVALID');
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('NOTIFICATION_LIMIT_INVALID');
  const remaining = Math.max(0, limit - acceptedInWindow);
  return { allowed: acceptedInWindow < limit, used: acceptedInWindow, remaining };
}

export function notificationWindowStart(now: Date): Date {
  if (Number.isNaN(now.getTime())) throw new Error('NOTIFICATION_DATE_INVALID');
  return new Date(now.getTime() - NOTIFICATION_RATE_WINDOW_MS);
}
