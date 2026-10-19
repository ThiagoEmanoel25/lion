import { describe, expect, it } from 'vitest';
import { proto, type WASocket } from '@whiskeysockets/baileys';
import { interactivePayload, nativeFlowButtons,outboundPresence,parseButtons,playbookAssetId, regularOutboundContent, sendInteractiveButtons } from './outbound-content.js';

describe('outbound WhatsApp content', () => {
  it('usa presença de gravação em áudio e digitação nas demais mensagens',()=>{
    expect(outboundPresence('AUDIO',4)).toBe('recording');
    expect(outboundPresence('IMAGE',4)).toBe('composing');
    expect(outboundPresence('TEXT',0)).toBeUndefined();
  });
  it('maps image, audio and sticker messages to Baileys media content', () => {
    expect(regularOutboundContent({ type: 'IMAGE', body: 'Legenda', mediaUrl: 'https://cdn.test/a.jpg', providerPayload: {} }))
      .toEqual({ image: { url: 'https://cdn.test/a.jpg' }, caption: 'Legenda' });
    expect(regularOutboundContent({ type: 'AUDIO', body: null, mediaUrl: 'https://cdn.test/a.ogg', providerPayload: { ptt: true } }))
      .toEqual({ audio: { url: 'https://cdn.test/a.ogg' }, ptt: true });
    expect(regularOutboundContent({ type: 'AUDIO', body: null, mediaUrl: 'https://cdn.test/a.ogg', providerPayload: { ptt: true,forwarded:true } }))
      .toEqual({ audio: { url: 'https://cdn.test/a.ogg' }, ptt: true,contextInfo:{isForwarded:true,forwardingScore:1} });
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

  it('uses private uploaded bytes and their stored content type',()=>{
    const data=Buffer.from('pdf');
    expect(playbookAssetId('nexo-asset://cmvfs3ut40011bbinvkji87uu')).toBe('cmvfs3ut40011bbinvkji87uu');
    expect(regularOutboundContent({type:'DOCUMENT',body:null,mediaUrl:'nexo-asset://cmvfs3ut40011bbinvkji87uu',providerPayload:{kind:'file',fileName:'recibo.pdf'}},{data,contentType:'application/pdf',fileName:'upload.pdf'})).toEqual({document:data,fileName:'recibo.pdf',mimetype:'application/pdf'});
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

describe('sendInteractiveButtons', () => {
  it('quotes the lead message in the interactive menu', async () => {
    const relayed: proto.IMessage[] = [];
    const socket = { user: { id: '5511999999999:1@s.whatsapp.net' }, relayMessage: async (_jid: string, message: proto.IMessage) => { relayed.push(message); return ''; } } as unknown as WASocket;
    const jid = '5511888888888@s.whatsapp.net';
    const quoted = proto.WebMessageInfo.create({ key: { remoteJid: jid, fromMe: false, id: 'LEAD-MSG-ID' }, message: { conversation: 'quero' } });
    await sendInteractiveButtons({ socket, jid, messageId: 'OUT-ID', text: 'Escolha', buttons: [{ id: 'a', label: 'A' }], quoted });
    const context = relayed[0]?.viewOnceMessage?.message?.interactiveMessage?.contextInfo;
    expect(context?.stanzaId).toBe('LEAD-MSG-ID');
    expect(context?.quotedMessage?.conversation).toBe('quero');
  });
});
