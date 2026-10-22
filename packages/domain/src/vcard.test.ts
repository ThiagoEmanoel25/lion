import { describe, expect, it } from 'vitest';
import { assertSticker, buildVCard, escapeVCardText, isWebp, normalizePhoneE164, STICKER_MAX_BYTES } from './vcard.js';

const unescape = (v: string) => v.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c));
const webp = (extra = 0) => { const b = new Uint8Array(12 + extra); b.set([0x52, 0x49, 0x46, 0x46], 0); b.set([0x57, 0x45, 0x42, 0x50], 8); return b; };

describe('escapeVCardText', () => {
  // Expected values are written with String.raw so every backslash is visible and real.
  it('escapes a semicolon with a real backslash', () => {
    expect(escapeVCardText('Silva; Jr')).toBe(String.raw`Silva\; Jr`);
    expect(escapeVCardText('Silva; Jr')).not.toBe('Silva; Jr');
    expect(escapeVCardText(';')).toBe(String.raw`\;`);
  });
  it('escapes comma, backslash and every newline form', () => {
    expect(escapeVCardText('a,b')).toBe(String.raw`a\,b`);
    expect(escapeVCardText(String.raw`a\b`)).toBe(String.raw`a\\b`);
    expect(escapeVCardText('l1\nl2\r\nl3\rl4')).toBe(String.raw`l1\nl2\nl3\nl4`);
    expect(escapeVCardText('Silva; Jr, a\\b')).toBe(String.raw`Silva\; Jr\, a\\b`);
  });
  it('round-trips through a spec-style unescape', () => {
    const raw = 'Silva; Jr, a\\b\nx';
    expect(unescape(escapeVCardText(raw))).toBe(raw);
  });
});

describe('normalizePhoneE164', () => {
  it.each([
    ['(11) 98765-4321', '5511987654321'], ['011 98765-4321', '5511987654321'], ['11987654321', '5511987654321'],
    ['1133334444', '551133334444'], ['+55 11 98765-4321', '5511987654321'], ['5511987654321', '5511987654321'],
    ['+1 415 555 2671', '14155552671'], ['0014155552671', '14155552671'],
  ])('%s -> %s', (raw, out) => expect(normalizePhoneE164(raw)).toBe(out));
  it('keeps old 8-digit mobiles as given (no ninth digit guess)', () => expect(normalizePhoneE164('11 8765-4321')).toBe('551187654321'));
  it.each(['', 'abc', '1234', '+123', '1234567890123456', '+0551199999999'])('rejects %j', raw => expect(normalizePhoneE164(raw)).toBeNull());
});

describe('buildVCard', () => {
  it('builds a valid 3.0 card with CRLF and an escaped name', () => {
    const card = buildVCard({ name: 'Silva; Jr, Ltda', phone: '(11) 98765-4321' });
    expect(card.split('\r\n')).toEqual(['BEGIN:VCARD', 'VERSION:3.0', String.raw`FN:Silva\; Jr\, Ltda`, String.raw`N:Silva\; Jr\, Ltda;;;;`, 'TEL;type=CELL;waid=5511987654321:+5511987654321', 'END:VCARD']);
  });
  it('a newline in the name cannot inject a property', () => {
    expect(buildVCard({ name: 'A\nTEL:+1', phone: '11987654321' }).split('\r\n')).toHaveLength(6);
  });
  it('throws on empty name or ambiguous phone', () => {
    expect(() => buildVCard({ name: ' ', phone: '11987654321' })).toThrow('INVALID_CONTACT_NAME');
    expect(() => buildVCard({ name: 'A', phone: '123' })).toThrow('INVALID_CONTACT_PHONE');
  });
});

describe('sticker bytes', () => {
  it('detects WebP by magic, not extension', () => {
    expect(isWebp(webp())).toBe(true);
    expect(isWebp(new TextEncoder().encode('\x89PNG\r\n\x1a\n....WEBP'))).toBe(false);
    expect(isWebp(new Uint8Array(4))).toBe(false);
  });
  it('enforces the 10 MB cap', () => {
    expect(() => assertSticker(webp(10))).not.toThrow();
    expect(() => assertSticker(webp(STICKER_MAX_BYTES))).toThrow('STICKER_TOO_LARGE');
    expect(() => assertSticker(new Uint8Array(100))).toThrow('STICKER_NOT_WEBP');
  });
});
