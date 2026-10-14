import { describe, expect, it } from 'vitest';
import { FieldCipher } from './field-cipher.js';

describe('FieldCipher', () => {
  it('round-trips a value without exposing plaintext', () => {
    const cipher = new FieldCipher(Buffer.alloc(32, 7));
    const encrypted = cipher.encrypt('segredo');
    expect(encrypted).not.toContain('segredo');
    expect(cipher.decrypt(encrypted)).toBe('segredo');
  });

  it('rejects a modified authentication tag', () => {
    const cipher = new FieldCipher(Buffer.alloc(32, 7));
    const parts = cipher.encrypt('segredo').split('.');
    parts[2] = Buffer.alloc(16, 2).toString('base64url');
    expect(() => cipher.decrypt(parts.join('.'))).toThrow();
  });
});
