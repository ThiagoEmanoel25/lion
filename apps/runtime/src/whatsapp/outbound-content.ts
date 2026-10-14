import { generateWAMessageFromContent, proto, type AnyMessageContent, type WASocket } from '@whiskeysockets/baileys';

type Button = { id: string; label: string };
type ProviderPayload = { kind?: unknown; ptt?: unknown; buttons?: unknown; footer?: unknown };

const payloadObject = (value: unknown): ProviderPayload => value && typeof value === 'object' && !Array.isArray(value) ? value as ProviderPayload : {};

export function parseButtons(value: unknown): Button[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const labelValue = typeof raw.label === 'string' ? raw.label : raw.title;
    const label = typeof labelValue === 'string' ? labelValue.trim() : '';
    return id && label ? [{ id, label }] : [];
  }).slice(0, 3);
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
}): Promise<string> {
  const { socket, jid, messageId, text, footer, buttons } = input;
  if (!socket.user?.id) throw new Error('WhatsApp socket has no authenticated user');
  if (!buttons.length) throw new Error('Interactive message requires at least one button');

  const generated = generateWAMessageFromContent(jid, {
    viewOnceMessage: {
      message: {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
        interactiveMessage: proto.Message.InteractiveMessage.create({
          body: proto.Message.InteractiveMessage.Body.create({ text }),
          ...(footer ? { footer: proto.Message.InteractiveMessage.Footer.create({ text: footer }) } : {}),
          nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
            buttons: buttons.map(button => ({
              name: 'quick_reply',
              buttonParamsJson: JSON.stringify({ display_text: button.label, id: button.id })
            }))
          })
        })
      }
    }
  }, { userJid: socket.user.id, messageId });

  await socket.relayMessage(jid, generated.message!, { messageId: generated.key.id! });
  return generated.key.id!;
}

export function interactivePayload(value: unknown) {
  const payload = payloadObject(value);
  return {
    buttons: parseButtons(payload.buttons),
    footer: typeof payload.footer === 'string' && payload.footer.trim() ? payload.footer.trim() : undefined
  };
}
