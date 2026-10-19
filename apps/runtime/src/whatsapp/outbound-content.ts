import { generateWAMessageFromContent, prepareWAMessageMedia, proto, type AnyMessageContent, type WASocket } from '@whiskeysockets/baileys';
import { MENU_MAX_OPTIONS } from '@nexo/contracts';

type Button = { id: string; label: string; description?: string };
type MenuMode = keyof typeof MENU_MAX_OPTIONS;
type ProviderPayload = { kind?: unknown; fileName?: unknown; ptt?: unknown; forwarded?:unknown;buttons?: unknown; footer?: unknown; mode?: unknown; buttonText?: unknown };

const payloadObject = (value: unknown): ProviderPayload => value && typeof value === 'object' && !Array.isArray(value) ? value as ProviderPayload : {};

export function parseButtons(value: unknown, mode: MenuMode = 'buttons'): Button[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const labelValue = typeof raw.label === 'string' ? raw.label : raw.title;
    const label = typeof labelValue === 'string' ? labelValue.trim() : '';
    const description = typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : undefined;
    return id && label ? [{ id, label, ...(description ? { description } : {}) }] : [];
  }).slice(0, MENU_MAX_OPTIONS[mode]);
}

const MIMETYPES: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', mp4: 'video/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const mimetypeOf = (fileName: string) => MIMETYPES[fileName.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
export const playbookAssetId=(url:string|null|undefined)=>url?.match(/^nexo-asset:\/\/([a-z0-9]{20,32})$/i)?.[1]??null;
type StoredAsset={data:Buffer;contentType:string;fileName:string};

export function outboundPresence(messageType:string,typingSeconds:number):'recording'|'composing'|undefined{
  if(typingSeconds<=0)return undefined;
  return messageType==='AUDIO'?'recording':'composing';
}

export function regularOutboundContent(message: { type: string; body: string | null; mediaUrl: string | null; providerPayload: unknown },asset?:StoredAsset|null): AnyMessageContent | null {
  const payload = payloadObject(message.providerPayload);
  const mediaUrl = message.mediaUrl?.trim();
  const media=asset?.data??(mediaUrl?{url:mediaUrl}:null);
  const forwarded=payload.forwarded===true?{contextInfo:{isForwarded:true,forwardingScore:1}}:{};
  if (payload.kind === 'buttons') return null;
  if (payload.kind === 'sticker' && media) return { sticker: media };
  if (message.type === 'IMAGE' && media) return { image: media, ...(message.body ? { caption: message.body } : {}),...forwarded };
  if (message.type === 'AUDIO' && media) return { audio: media, ptt: payload.ptt === true,...forwarded };
  if (message.type === 'VIDEO' && media) return { video: media, ...(message.body ? { caption: message.body } : {}),...forwarded };
  if (message.type === 'DOCUMENT' && media) {
    const fileName = typeof payload.fileName === 'string' && payload.fileName ? payload.fileName : asset?.fileName??'arquivo';
    return { document: media, fileName, mimetype: asset?.contentType??mimetypeOf(fileName), ...(message.body ? { caption: message.body } : {}) };
  }
  return { text: message.body ?? '' };
}

export async function sendInteractiveButtons(input: {
  socket: WASocket;
  jid: string;
  messageId: string;
  text: string;
  footer?: string;
  buttons: Button[];
  mode?: MenuMode;
  buttonText?: string;
  imageUrl?: string | null;
  imageData?: Buffer | null;
  quoted?: proto.IWebMessageInfo;
}): Promise<string> {
  const { socket, jid, messageId, text, footer, buttons, mode = 'buttons', buttonText, imageUrl,imageData, quoted } = input;
  if (!socket.user?.id) throw new Error('WhatsApp socket has no authenticated user');
  if (!buttons.length) throw new Error('Interactive message requires at least one button');

  // The image header must be uploaded to WhatsApp first; only the buttons format shows it.
  const image=imageData??(imageUrl?{url:imageUrl}:null);
  const media = image && mode === 'buttons' ? await prepareWAMessageMedia({ image }, { upload: socket.waUploadToServer }) : null;
  const generated = generateWAMessageFromContent(jid, {
    viewOnceMessage: {
      message: {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
        interactiveMessage: proto.Message.InteractiveMessage.create({
          ...(media?.imageMessage ? { header: proto.Message.InteractiveMessage.Header.create({ hasMediaAttachment: true, imageMessage: media.imageMessage }) } : {}),
          body: proto.Message.InteractiveMessage.Body.create({ text }),
          ...(footer ? { footer: proto.Message.InteractiveMessage.Footer.create({ text: footer }) } : {}),
          nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({ buttons: nativeFlowButtons(mode, buttons, buttonText) })
        })
      }
    }
  }, { userJid: socket.user.id, messageId, ...(quoted ? { quoted } : {}) });

  await socket.relayMessage(jid, generated.message!, { messageId: generated.key.id! });
  return generated.key.id!;
}

// Buttons are one quick_reply per option; a list is a single single_select button that opens the rows.
export function nativeFlowButtons(mode: MenuMode, buttons: Button[], buttonText?: string) {
  if (mode === 'list') {
    const title = buttonText?.trim() || 'Ver opções';
    return [{
      name: 'single_select',
      buttonParamsJson: JSON.stringify({ title, sections: [{ title, rows: buttons.map(button => ({ id: button.id, title: button.label, ...(button.description ? { description: button.description } : {}) })) }] })
    }];
  }
  return buttons.map(button => ({ name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: button.label, id: button.id }) }));
}

export function interactivePayload(value: unknown) {
  const payload = payloadObject(value);
  const mode: MenuMode = payload.mode === 'list' ? 'list' : 'buttons';
  return {
    mode,
    buttonText: typeof payload.buttonText === 'string' && payload.buttonText.trim() ? payload.buttonText.trim() : undefined,
    buttons: parseButtons(payload.buttons, mode),
    footer: typeof payload.footer === 'string' && payload.footer.trim() ? payload.footer.trim() : undefined
  };
}
