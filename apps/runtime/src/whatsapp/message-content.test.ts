import { describe, expect, it } from 'vitest';
import { messageBody, messageType } from './message-content.js';

describe('message content', () => {
  it('extracts text wrapped in an ephemeral message', () => {
    expect(messageBody({ ephemeralMessage: { message: { conversation: 'olá' } } })).toBe('olá');
  });

  it('classifies media messages', () => {
    expect(messageType({ imageMessage: { caption: 'foto' } })).toBe('IMAGE');
  });
});
