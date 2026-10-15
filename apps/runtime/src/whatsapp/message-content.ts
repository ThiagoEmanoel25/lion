import type { proto } from '@whiskeysockets/baileys';

// WhatsApp wraps content in ephemeral/view-once envelopes; read the inner message.
function unwrap(message: proto.IMessage | null | undefined): proto.IMessage | null {
  if (!message) return null;
  const inner = message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message.viewOnceMessageV2?.message;
  return inner ? unwrap(inner) : message;
}

export type MenuReply = { id: string; text: string | null };

// The option a contact picked in a menu. Our menus go out as native flow messages, so the reply
// arrives as interactiveResponseMessage; the legacy buttons/list replies are kept for older clients.
export function menuReply(raw: proto.IMessage | null | undefined): MenuReply | null {
  const message = unwrap(raw);
  if (!message) return null;
  const native = message.interactiveResponseMessage;
  if (native?.nativeFlowResponseMessage?.paramsJson) {
    try {
      const params: unknown = JSON.parse(native.nativeFlowResponseMessage.paramsJson);
      const id = params && typeof params === 'object' && typeof (params as { id?: unknown }).id === 'string' ? (params as { id: string }).id : '';
      if (id) return { id, text: native.body?.text || null };
    } catch { /* malformed params from the client: treat as no reply */ }
  }
  const list = message.listResponseMessage;
  if (list?.singleSelectReply?.selectedRowId) return { id: list.singleSelectReply.selectedRowId, text: list.title || null };
  const buttons = message.buttonsResponseMessage;
  if (buttons?.selectedButtonId) return { id: buttons.selectedButtonId, text: buttons.selectedDisplayText || null };
  const template = message.templateButtonReplyMessage;
  if (template?.selectedId) return { id: template.selectedId, text: template.selectedDisplayText || null };
  return null;
}

export function messageBody(raw: proto.IMessage | null | undefined): string | null {
  const message = unwrap(raw);
  if (!message) return null;
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  if (message.documentMessage?.caption) return message.documentMessage.caption;
  if (message.buttonsResponseMessage?.selectedDisplayText) return message.buttonsResponseMessage.selectedDisplayText;
  if (message.listResponseMessage?.title) return message.listResponseMessage.title;
  const reply = menuReply(message);
  return reply ? reply.text ?? reply.id : null;
}

export function messageType(raw: proto.IMessage | null | undefined) {
  const message = unwrap(raw);
  if (message?.imageMessage) return 'IMAGE' as const;
  if (message?.audioMessage) return 'AUDIO' as const;
  if (message?.videoMessage) return 'VIDEO' as const;
  if (message?.documentMessage) return 'DOCUMENT' as const;
  return 'TEXT' as const;
}
