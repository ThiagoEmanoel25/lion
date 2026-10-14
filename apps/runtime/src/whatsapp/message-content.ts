import type { proto } from '@whiskeysockets/baileys';

export function messageBody(message: proto.IMessage | null | undefined): string | null {
  if (!message) return null;
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  if (message.documentMessage?.caption) return message.documentMessage.caption;
  if (message.buttonsResponseMessage?.selectedDisplayText) return message.buttonsResponseMessage.selectedDisplayText;
  if (message.listResponseMessage?.title) return message.listResponseMessage.title;
  if (message.ephemeralMessage?.message) return messageBody(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return messageBody(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return messageBody(message.viewOnceMessageV2.message);
  return null;
}

export function messageType(message: proto.IMessage | null | undefined) {
  if (message?.imageMessage) return 'IMAGE' as const;
  if (message?.audioMessage) return 'AUDIO' as const;
  if (message?.videoMessage) return 'VIDEO' as const;
  if (message?.documentMessage) return 'DOCUMENT' as const;
  return 'TEXT' as const;
}
