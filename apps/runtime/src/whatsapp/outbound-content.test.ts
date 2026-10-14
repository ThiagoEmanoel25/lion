import { describe, expect, it } from 'vitest';
import { interactivePayload, parseButtons, regularOutboundContent } from './outbound-content.js';

describe('outbound WhatsApp content', () => {
  it('maps image, audio and sticker messages to Baileys media content', () => {
    expect(regularOutboundContent({ type: 'IMAGE', body: 'Legenda', mediaUrl: 'https://cdn.test/a.jpg', providerPayload: {} }))
      .toEqual({ image: { url: 'https://cdn.test/a.jpg' }, caption: 'Legenda' });
    expect(regularOutboundContent({ type: 'AUDIO', body: null, mediaUrl: 'https://cdn.test/a.ogg', providerPayload: { ptt: true } }))
      .toEqual({ audio: { url: 'https://cdn.test/a.ogg' }, ptt: true });
    expect(regularOutboundContent({ type: 'IMAGE', body: null, mediaUrl: 'https://cdn.test/a.webp', providerPayload: { kind: 'sticker' } }))
      .toEqual({ sticker: { url: 'https://cdn.test/a.webp' } });
  });

  it('recognizes interactive messages and accepts label/title during migration', () => {
    const payload = { kind: 'buttons', footer: 'Rodape', buttons: [{ id: 'yes', label: 'Sim' }, { id: 'no', title: 'Não' }] };
    expect(regularOutboundContent({ type: 'TEMPLATE', body: 'Escolha', mediaUrl: null, providerPayload: payload })).toBeNull();
    expect(interactivePayload(payload)).toEqual({ footer: 'Rodape', buttons: [{ id: 'yes', label: 'Sim' }, { id: 'no', label: 'Não' }] });
    expect(parseButtons([{ id: '', label: 'Inválido' }, null])).toEqual([]);
  });
});
