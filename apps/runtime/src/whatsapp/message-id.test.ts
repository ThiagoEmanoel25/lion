import { describe, expect, it } from 'vitest';
import { outboundMessageId } from './message-id.js';

describe('outboundMessageId', () => {
  it('is stable and shaped like a Baileys message id', () => {
    expect(outboundMessageId('request-1')).toBe(outboundMessageId('request-1'));
    expect(outboundMessageId('request-1')).toMatch(/^[A-F0-9]{20}$/);
    expect(outboundMessageId('request-1')).not.toBe(outboundMessageId('request-2'));
  });
});
