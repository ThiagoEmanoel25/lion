import { describe, expect, it } from 'vitest';
import { interactivePayload, nativeFlowButtons, parseButtons, regularOutboundContent } from './outbound-content.js';

describe('outbound WhatsApp content', () => {
  it('maps image, audio and sticker messages to Baileys media content', () => {
    expect(regularOutboundContent({ type: 'IMAGE', body: 'Legenda', mediaUrl: 'https://cdn.test/a.jpg', providerPayload: {} }))
      .toEqual({ image: { url: 'https://cdn.test/a.jpg' }, caption: 'Legenda' });
    expect(regularOutboundContent({ type: 'AUDIO', body: null, mediaUrl: 'https://cdn.test/a.ogg', providerPayload: { ptt: true } }))
      .toEqual({ audio: { url: 'https://cdn.test/a.ogg' }, ptt: true });
    expect(regularOutboundContent({ type: 'IMAGE', body: null, mediaUrl: 'https://cdn.test/a.webp', providerPayload: { kind: 'sticker' } }))
      .toEqual({ sticker: { url: 'https://cdn.test/a.webp' } });
  });

  it('maps document (mimetype by extension) and video content', () => {
    expect(regularOutboundContent({ type: 'DOCUMENT', body: 'Contrato', mediaUrl: 'https://cdn.test/a.pdf', providerPayload: { kind: 'file', fileName: 'Contrato.pdf' } }))
      .toEqual({ document: { url: 'https://cdn.test/a.pdf' }, fileName: 'Contrato.pdf', mimetype: 'application/pdf', caption: 'Contrato' });
    expect(regularOutboundContent({ type: 'DOCUMENT', body: null, mediaUrl: 'https://cdn.test/a.xyz', providerPayload: { kind: 'file', fileName: 'a.xyz' } }))
      .toEqual({ document: { url: 'https://cdn.test/a.xyz' }, fileName: 'a.xyz', mimetype: 'application/octet-stream' });
    expect(regularOutboundContent({ type: 'VIDEO', body: 'Olha', mediaUrl: 'https://cdn.test/a.mp4', providerPayload: {} }))
      .toEqual({ video: { url: 'https://cdn.test/a.mp4' }, caption: 'Olha' });
    expect(regularOutboundContent({ type: 'TEXT', body: 'Oi', mediaUrl: null, providerPayload: {} })).toEqual({ text: 'Oi' });
  });

  it('recognizes interactive messages and accepts label/title during migration', () => {
    const payload = { kind: 'buttons', footer: 'Rodape', buttons: [{ id: 'yes', label: 'Sim' }, { id: 'no', title: 'Não' }] };
    expect(regularOutboundContent({ type: 'TEMPLATE', body: 'Escolha', mediaUrl: null, providerPayload: payload })).toBeNull();
    expect(interactivePayload(payload)).toEqual({ mode: 'buttons', buttonText: undefined, footer: 'Rodape', buttons: [{ id: 'yes', label: 'Sim' }, { id: 'no', label: 'Não' }] });
    expect(parseButtons([{ id: '', label: 'Inválido' }, null])).toEqual([]);
  });

  it('sends a list as one single_select button with up to 10 rows', () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({ id: `r${index}`, label: `Opção ${index}`, ...(index === 0 ? { description: 'Mais pedida' } : {}) }));
    const payload = interactivePayload({ kind: 'buttons', mode: 'list', buttonText: 'Ver planos', buttons: rows });
    expect(payload.buttons).toHaveLength(10);
    const [button, ...rest] = nativeFlowButtons(payload.mode, payload.buttons, payload.buttonText);
    expect(rest).toEqual([]);
    expect(button!.name).toBe('single_select');
    const params = JSON.parse(button!.buttonParamsJson) as { title: string; sections: Array<{ rows: Array<{ id: string; title: string; description?: string }> }> };
    expect(params.title).toBe('Ver planos');
    expect(params.sections[0]!.rows[0]).toEqual({ id: 'r0', title: 'Opção 0', description: 'Mais pedida' });
  });

  it('keeps buttons mode as quick replies capped at 3', () => {
    const payload = interactivePayload({ kind: 'buttons', buttons: [1, 2, 3, 4].map(n => ({ id: `b${n}`, label: `B${n}` })) });
    expect(nativeFlowButtons(payload.mode, payload.buttons).map(button => button.name)).toEqual(['quick_reply', 'quick_reply', 'quick_reply']);
  });
});
