import { describe, expect, it } from 'vitest';
import { itemMessage, pauseSeconds, safeMediaUrl, sequenceItems, sequenceJobOptions, sequenceOf } from './message-sequence.js';

describe('sequenceItems', () => {
  it('turns the legacy { text } into one text item', () => {
    expect(sequenceItems({ text: 'Oi' })).toEqual([{ type: 'text', text: 'Oi', typingSeconds: 0 }]);
  });
  it('validates items and resolves typingSeconds', () => {
    expect(sequenceItems({ items: [{ type: 'text', text: 'A' }, { type: 'pause', minSeconds: 1, maxSeconds: 2 }] }))
      .toEqual([{ type: 'text', text: 'A', typingSeconds: 0 }, { type: 'pause', minSeconds: 1, maxSeconds: 2 }]);
  });
  it('throws on an invalid item and returns [] when empty', () => {
    expect(() => sequenceItems({ items: [{ type: 'file', url: 'http://x/a.pdf', fileName: 'a.pdf' }] })).toThrow('INVALID_MESSAGE_ITEM');
    expect(sequenceItems({})).toEqual([]);
  });
  it('enforces the sequence bounds at runtime too', () => {
    expect(() => sequenceItems({ items: [] })).toThrow('INVALID_MESSAGE_ITEM_COUNT');
    expect(() => sequenceItems({ items: Array.from({ length: 31 }, () => ({ type: 'text', text: 'Oi' })) })).toThrow('INVALID_MESSAGE_ITEM_COUNT');
  });
});

describe('pauseSeconds', () => {
  it('is uniform over [min, max]', () => {
    expect(pauseSeconds({ minSeconds: 2, maxSeconds: 5 }, () => 0)).toBe(2);
    expect(pauseSeconds({ minSeconds: 2, maxSeconds: 5 }, () => 0.9999)).toBe(5);
    expect(pauseSeconds({ minSeconds: 3, maxSeconds: 3 }, () => 0.7)).toBe(3);
    expect(pauseSeconds({ minSeconds: 2, maxSeconds: 5 }, () => 1)).toBe(5);
  });
});

describe('itemMessage', () => {
  const ctx = { contact: { name: 'Ana' }, f: 'doc.pdf' };
  it('maps text with typing and interpolation', () => {
    expect(itemMessage({ type: 'text', text: 'Oi {{contact.name}}', typingSeconds: 3 }, ctx))
      .toEqual({ type: 'TEXT', body: 'Oi Ana', mediaUrl: null, providerPayload: { typingSeconds: 3 } });
    expect(itemMessage({ type: 'text', text: 'Oi', typingSeconds: 0 }, ctx).providerPayload).toEqual({});
  });
  it('maps file, media and audio', () => {
    expect(itemMessage({ type: 'file', url: 'https://x/a.pdf', fileName: '{{f}}', caption: 'Veja {{contact.name}}' }, ctx))
      .toEqual({ type: 'DOCUMENT', body: 'Veja Ana', mediaUrl: 'https://x/a.pdf', providerPayload: { kind: 'file', fileName: 'doc.pdf' } });
    expect(itemMessage({ type: 'media', mediaType: 'video', url: 'https://x/a.mp4', caption: 'v' }, ctx))
      .toEqual({ type: 'VIDEO', body: 'v', mediaUrl: 'https://x/a.mp4', providerPayload: {} });
    expect(itemMessage({ type: 'media', mediaType: 'image', url: 'https://x/a.png' }, ctx).type).toBe('IMAGE');
    expect(itemMessage({ type: 'media', mediaType: 'audio', url: 'https://x/a.ogg', ptt: true }, ctx))
      .toEqual({ type: 'AUDIO', body: null, mediaUrl: 'https://x/a.ogg', providerPayload: { kind: 'audio', ptt: true } });
  });
  it('rejects empty text and non-https urls', () => {
    expect(() => itemMessage({ type: 'text', text: '{{nope}}', typingSeconds: 0 }, ctx)).toThrow('EMPTY_MESSAGE');
    expect(() => itemMessage({ type: 'media', mediaType: 'image', url: '{{nope}}' }, ctx)).toThrow('MEDIA_HTTPS_REQUIRED');
    expect(() => itemMessage({ type: 'file', url: 'http://x/a.pdf', fileName: 'a' }, ctx)).toThrow('MEDIA_HTTPS_REQUIRED');
  });
  it('validates values after interpolation', () => {
    expect(() => itemMessage({ type: 'text', text: '{{long}}', typingSeconds: 0 }, { long: 'a'.repeat(4097) })).toThrow('MESSAGE_TOO_LONG');
    expect(() => itemMessage({ type: 'file', url: 'https://x.test/a.pdf', fileName: '{{empty}}' }, ctx)).toThrow('EMPTY_FILE_NAME');
    expect(() => itemMessage({ type: 'file', url: 'https://x.test/a.pdf', fileName: '{{long}}' }, { long: 'a'.repeat(256) })).toThrow('FILE_NAME_TOO_LONG');
    expect(() => itemMessage({ type: 'media', mediaType: 'image', url: 'https://x.test/a.png', caption: '{{long}}' }, { long: 'a'.repeat(1025) })).toThrow('CAPTION_TOO_LONG');
  });
});

describe('safeMediaUrl', () => {
  it('accepts public HTTPS and rejects credentials, local hosts and private IP literals', () => {
    expect(safeMediaUrl('https://cdn.example.com/a.pdf')).toBe('https://cdn.example.com/a.pdf');
    expect(() => safeMediaUrl('https://user:pass@cdn.example.com/a')).toThrow('MEDIA_HTTPS_REQUIRED');
    expect(() => safeMediaUrl('https://localhost/a')).toThrow('MEDIA_PRIVATE_HOST');
    expect(() => safeMediaUrl('https://127.0.0.1/a')).toThrow('MEDIA_PRIVATE_HOST');
    expect(() => safeMediaUrl('https://[::1]/a')).toThrow('MEDIA_PRIVATE_HOST');
    expect(() => safeMediaUrl('https://[::ffff:127.0.0.1]/a')).toThrow('MEDIA_PRIVATE_HOST');
  });
});

describe('sequenceOf / sequenceJobOptions', () => {
  it('reads the sequence ref from providerPayload and ignores anything else', () => {
    expect(sequenceOf({ typingSeconds: 3, sequence: { executionId: 'e', stepId: 's', index: 1 } })).toEqual({ executionId: 'e', stepId: 's', index: 1 });
    expect(sequenceOf({ sequence: { executionId: 'e', stepId: 's' } })).toBeUndefined();
    expect(sequenceOf({ sequence: { executionId: 'e', stepId: 's', index: -1 } })).toBeUndefined();
    expect(sequenceOf({ sequence: { executionId: 'e', stepId: 's', index: 1.5 } })).toBeUndefined();
    expect(sequenceOf(null)).toBeUndefined();
  });
  it('uses one fixed jobId per step and next index', () => {
    expect(sequenceJobOptions('s', 2).jobId).toBe('automation-seq-s-2');
    expect(sequenceJobOptions('s', 2, 3_000)).toMatchObject({ delay: 3_000, attempts: 5 });
  });
});
