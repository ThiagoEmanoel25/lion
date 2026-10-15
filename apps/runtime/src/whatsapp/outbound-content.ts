import { generateWAMessageFromContent, prepareWAMessageMedia, proto, type AnyMessageContent, type WASocket } from '@whiskeysockets/baileys';
import { MENU_MAX_OPTIONS } from '@nexo/contracts';

type Button = { id: string; label: string; description?: string };
type MenuMode = keyof typeof MENU_MAX_OPTIONS;
type ProviderPayload = { kind?: unknown; ptt?: unknown; buttons?: unknown; footer?: unknown; mode?: unknown; buttonText?: unknown };

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

export function regularOutboundContent(message: { type: string; body: string | null; mediaUrl: string | null; providerPayload: unknown }): AnyMessageContent | null {
  const payload = payloadObject(message.providerPayload);
  const mediaUrl = message.mediaUrl?.trim();
  if (payload.kind === 'buttons') return null;
  if (payload.kind === 'sticker' && mediaUrl) return { sticker: { url: mediaUrl } };
  if (message.type === 'IMAGE' && mediaUrl) return { image: { url: mediaUrl }, ...(message.body ? { caption: message.body } : {}) };
  if (message.type === 'AUDIO' && mediaUrl) return { audio: { url: mediaUrl }, ptt: payload.ptt === true };
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
}): Promise<string> {
  const { socket, jid, messageId, text, footer, buttons, mode = 'buttons', buttonText, imageUrl } = input;
  if (!socket.user?.id) throw new Error('WhatsApp socket has no authenticated user');
  if (!buttons.length) throw new Error('Interactive message requires at least one button');

  // The image header must be uploaded to WhatsApp first; only the buttons format shows it.
  const media = imageUrl && mode === 'buttons' ? await prepareWAMessageMedia({ image: { url: imageUrl } }, { upload: socket.waUploadToServer }) : null;
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
  }, { userJid: socket.user.id, messageId });

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
