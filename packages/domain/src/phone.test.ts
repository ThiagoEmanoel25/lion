import { describe, expect, it } from 'vitest';
import { normalizePhone } from './phone.js';

describe('normalizePhone', () => {
  it.each([
    ['+55 71 99912-4830', '+5571999124830'],
    ['5571999124830', '+5571999124830'],
    ['(71) 99912-4830', '+5571999124830'],
    ['00 55 71 9991 24830', '+5571999124830'],
    ['7133334444', '+557133334444'],
    ['+1 (415) 555-2671', '+14155552671'],
    ['+5511966001001', '+5511966001001']
  ])('%s -> %s', (raw, expected) => expect(normalizePhone(raw)).toBe(expected));
  it.each(['abc', '', '123', '   ', '71 9991-ABCD', '+55 71 99912-4830 ramal 2', '55+71999124830', '+123', '1234567890123456', '0719991248'])('%j -> null', raw => expect(normalizePhone(raw)).toBeNull());
  it('é idempotente', () => expect(normalizePhone(normalizePhone('(71) 99912-4830')!)).toBe('+5571999124830'));
});
