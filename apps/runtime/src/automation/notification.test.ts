import { describe, expect, it } from 'vitest';
import { decideNotificationLimit, isE164, normalizeE164, notificationWindowStart } from './notification.js';

describe('notification', () => {
  describe('E.164', () => {
    it('normalizes Brazilian numbers and common international prefixes', () => {
      expect(normalizeE164('+55 (71) 98315-6656')).toBe('+5571983156656');
      expect(normalizeE164('5571983156656')).toBe('+5571983156656');
      expect(normalizeE164('0055 71 98315-6656')).toBe('+5571983156656');
    });

    it('rejects short numbers, extensions, zero country code and numbers over 15 digits', () => {
      expect(normalizeE164('315-6656')).toBeNull();
      expect(normalizeE164('+55 71 98315-6656 ramal 2')).toBeNull();
      expect(normalizeE164('+0123456789')).toBeNull();
      expect(normalizeE164('+1234567890123456')).toBeNull();
    });

    it('distinguishes canonical values from merely normalizable ones', () => {
      expect(isE164('+5571983156656')).toBe(true);
      expect(isE164('+55 71 98315-6656')).toBe(false);
    });
  });

  describe('hourly limit', () => {
    it('allows the first 30 notifications and blocks the next one', () => {
      expect(decideNotificationLimit(0)).toEqual({ allowed: true, used: 0, remaining: 30 });
      expect(decideNotificationLimit(29)).toEqual({ allowed: true, used: 29, remaining: 1 });
      expect(decideNotificationLimit(30)).toEqual({ allowed: false, used: 30, remaining: 0 });
      expect(decideNotificationLimit(31)).toEqual({ allowed: false, used: 31, remaining: 0 });
    });

    it('calculates the rolling one-hour boundary', () => {
      expect(notificationWindowStart(new Date('2026-10-18T15:30:00.000Z')).toISOString()).toBe('2026-10-18T14:30:00.000Z');
    });

    it('rejects invalid counters and limits', () => {
      expect(() => decideNotificationLimit(-1)).toThrow('NOTIFICATION_COUNT_INVALID');
      expect(() => decideNotificationLimit(0, 0)).toThrow('NOTIFICATION_LIMIT_INVALID');
    });
  });
});
