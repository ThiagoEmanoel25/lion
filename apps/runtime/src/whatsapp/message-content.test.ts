import { describe, expect, it } from 'vitest';
import { ctwaOf, withCtwa, MEDIA_MAX_BYTES, MEDIA_DOWNLOAD_TIMEOUT_MS, mediaDownloadOptions, menuReply, messageBody, messageType, storableMedia } from './message-content.js';

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

  it('marca imagem, áudio e PDF até 10 MB para baixar, maiores só como metadado', () => {
    expect(storableMedia({ imageMessage: { mimetype: 'image/jpeg', fileLength: 2048 } })).toEqual({ contentType: 'image/jpeg', fileName: null, size: 2048, download: true });
    expect(storableMedia({ audioMessage: { mimetype: 'audio/ogg; codecs=opus', fileLength: 512 } })).toEqual({ contentType: 'audio/ogg; codecs=opus', fileName: null, size: 512, download: true });
    expect(storableMedia({ documentMessage: { mimetype: 'application/pdf', fileName: 'comprovante.pdf', fileLength: MEDIA_MAX_BYTES + 1 } })).toEqual({ contentType: 'application/pdf', fileName: 'comprovante.pdf', size: MEDIA_MAX_BYTES + 1, download: false });
    expect(storableMedia({ ephemeralMessage: { message: { imageMessage: { mimetype: 'image/png', fileLength: 10 } } } })?.download).toBe(true);
  });

  it('ignora documentos que não são PDF/imagem e mensagens de texto', () => {
    expect(storableMedia({ documentMessage: { mimetype: 'application/zip', fileLength: 10 } })).toBeNull();
    expect(storableMedia({ conversation: 'oi' })).toBeNull();
  });

  it('bounds inbound media downloads by time and size', () => {
    const { options } = mediaDownloadOptions();
    expect(MEDIA_DOWNLOAD_TIMEOUT_MS).toBe(30_000);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.maxContentLength).toBeGreaterThan(MEDIA_MAX_BYTES);
  });
  it('reads ctwaClid from any message type, inside envelopes', () => {
    expect(ctwaOf({ extendedTextMessage: { text: 'oi', contextInfo: { externalAdReply: { ctwaClid: 'clid_1' } } } })).toEqual({ clid: 'clid_1' });
    expect(ctwaOf({ ephemeralMessage: { message: { imageMessage: { contextInfo: { externalAdReply: { ctwaClid: 'clid_2', sourceId: 'ad_9' } } } } } })).toEqual({ clid: 'clid_2', sourceId: 'ad_9' });
    expect(ctwaOf({ conversation: 'oi' })).toBeNull();
    expect(ctwaOf({ extendedTextMessage: { contextInfo: { externalAdReply: { ctwaClid: '' } } } })).toBeNull();
    expect(ctwaOf(null)).toBeNull();
  });

  it('stores ctwa once and keeps other metadata', () => {
    const now = new Date('2026-10-17T12:00:00.000Z');
    expect(withCtwa({ foo: 1 }, { clid: 'clid' }, now)).toEqual({ foo: 1, ctwa: { clid: 'clid', receivedAt: '2026-10-17T12:00:00.000Z' } });
    expect(withCtwa(null, { clid: 'clid', sourceId: 'ad_9' }, now)).toEqual({ ctwa: { clid: 'clid', sourceId: 'ad_9', receivedAt: '2026-10-17T12:00:00.000Z' } });
    expect(withCtwa({ ctwa: { clid: 'old' } }, { clid: 'new' }, now)).toBeNull();
    expect(withCtwa({ foo: 1 }, null, now)).toBeNull();
  });
});
