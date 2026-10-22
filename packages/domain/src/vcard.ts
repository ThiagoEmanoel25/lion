// vCard 3.0 (RFC 2426) for WhatsApp contact cards, plus the sticker byte checks. Hand-built: no vcard dependency.
export const STICKER_MAX_BYTES = 10 * 1024 * 1024;

/** Backslash first, then `;` `,` and line breaks (CRLF, CR, LF all become the literal `\n`). */
export const escapeVCardText = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');

/**
 * Normalizes a phone to E.164 digits (no "+"), or null when it cannot be done safely.
 * - "+..." or "00..." is international: kept as typed (8-15 digits).
 * - 10-11 digits (DDD + number, optional leading trunk 0) are Brazilian: "55" is prepended.
 * - 12-13 digits are taken as already carrying a country code (55 or otherwise).
 * - Old 8-digit mobiles (DDD + 8 digits starting 6-9) are NOT upgraded with the ninth digit: guessing it would
 *   send the card to a different person if wrong. They are kept as given; a wrong number just won't resolve on WhatsApp.
 * - Anything else (too short/long, no digits) is ambiguous: null, the caller must fail loudly.
 */
export function normalizePhoneE164(raw: string): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  const international = trimmed.startsWith('+') || digits.startsWith('00');
  const body = international && !trimmed.startsWith('+') ? digits.slice(2) : digits;
  if (international) return body.length >= 8 && body.length <= 15 && !body.startsWith('0') ? body : null;
  const national = body.replace(/^0+/, '');
  if (national.length === 10 || national.length === 11) return `55${national}`;
  if (body.length >= 12 && body.length <= 13 && !body.startsWith('0')) return body;
  return null;
}

export function buildVCard(input: { name: string; phone: string }): string {
  const name = input.name.trim();
  if (!name) throw new Error('INVALID_CONTACT_NAME');
  const e164 = normalizePhoneE164(input.phone);
  if (!e164) throw new Error('INVALID_CONTACT_PHONE');
  // ponytail: no 75-octet line folding; WhatsApp parses long unfolded lines fine. Add folding if another consumer needs it.
  return ['BEGIN:VCARD', 'VERSION:3.0', `FN:${escapeVCardText(name)}`, `N:${escapeVCardText(name)};;;;`, `TEL;type=CELL;waid=${e164}:+${e164}`, 'END:VCARD'].join('\r\n');
}

/** RIFF....WEBP magic; the file extension and the declared content type are never trusted. */
export const isWebp = (bytes: Uint8Array): boolean =>
  bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';

export function assertSticker(bytes: Uint8Array): void {
  if (bytes.length > STICKER_MAX_BYTES) throw new Error('STICKER_TOO_LARGE');
  if (!isWebp(bytes)) throw new Error('STICKER_NOT_WEBP');
}
