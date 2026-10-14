import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class FieldCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('FieldCipher requires a 32-byte key');
  }

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
  }

  decrypt(value: string): string {
    const [version, ivValue, tagValue, encryptedValue] = value.split('.');
    if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) throw new Error('Invalid encrypted field');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8');
  }
}
