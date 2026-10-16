import { describe, expect, it } from 'vitest';
import { itemMessage, pauseSeconds, sequenceItems } from './message-sequence.js';

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
});

describe('pauseSeconds', () => {
  it('is uniform over [min, max]', () => {
    expect(pauseSeconds({ minSeconds: 2, maxSeconds: 5 }, () => 0)).toBe(2);
    expect(pauseSeconds({ minSeconds: 2, maxSeconds: 5 }, () => 0.9999)).toBe(5);
    expect(pauseSeconds({ minSeconds: 3, maxSeconds: 3 }, () => 0.7)).toBe(3);
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
});
