import { describe, expect, it } from 'vitest';
import { menuReply, messageBody, messageType } from './message-content.js';

describe('message content', () => {
  it('extracts text wrapped in an ephemeral message', () => {
    expect(messageBody({ ephemeralMessage: { message: { conversation: 'olá' } } })).toBe('olá');
  });

  it('classifies media messages', () => {
    expect(messageType({ imageMessage: { caption: 'foto' } })).toBe('IMAGE');
  });

  it('reads the option picked in a native flow menu', () => {
    const message = { interactiveResponseMessage: { body: { text: 'Opção 1' }, nativeFlowResponseMessage: { name: 'quick_reply', paramsJson: '{"id":"option_1"}' } } };
    expect(menuReply(message)).toEqual({ id: 'option_1', text: 'Opção 1' });
    expect(messageBody(message)).toBe('Opção 1');
  });

  it('reads list replies by row id, even inside an envelope', () => {
    const message = { ephemeralMessage: { message: { listResponseMessage: { title: 'Plano Pro', singleSelectReply: { selectedRowId: 'pro' } } } } };
    expect(menuReply(message)).toEqual({ id: 'pro', text: 'Plano Pro' });
  });

  it('ignores malformed native flow params and plain text', () => {
    expect(menuReply({ interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: 'not json' } } })).toBeNull();
    expect(menuReply({ conversation: 'oi' })).toBeNull();
  });
});
