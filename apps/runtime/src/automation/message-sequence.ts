import { AutomationMessageItemSchema } from '@nexo/contracts';
import type { z } from 'zod';
import { renderTemplate } from './routing.js';

export type SequenceItem = z.output<typeof AutomationMessageItemSchema>;
type SendItem = Exclude<SequenceItem, { type: 'pause' }>;

export function sequenceItems(config: Record<string, unknown>): SequenceItem[] {
  if (Array.isArray(config.items)) {
    return config.items.map(raw => {
      const parsed = AutomationMessageItemSchema.safeParse(raw);
      if (!parsed.success) throw new Error('INVALID_MESSAGE_ITEM');
      return parsed.data;
    });
  }
  return typeof config.text === 'string' && config.text.trim() ? [{ type: 'text', text: config.text, typingSeconds: 0 }] : [];
}

export const pauseSeconds = (item: { minSeconds: number; maxSeconds: number }, random: () => number = Math.random): number =>
  item.minSeconds + Math.floor(random() * (item.maxSeconds - item.minSeconds + 1));

export function itemMessage(item: SendItem, context: Record<string, unknown>): { type: 'TEXT' | 'DOCUMENT' | 'IMAGE' | 'VIDEO' | 'AUDIO'; body: string | null; mediaUrl: string | null; providerPayload: Record<string, unknown> } {
  if (item.type === 'text') {
    const body = renderTemplate(item.text, context).trim();
    if (!body) throw new Error('EMPTY_MESSAGE');
    return { type: 'TEXT', body, mediaUrl: null, providerPayload: item.typingSeconds > 0 ? { typingSeconds: item.typingSeconds } : {} };
  }
  const mediaUrl = renderTemplate(item.url, context).trim();
  if (!mediaUrl.startsWith('https://')) throw new Error('MEDIA_HTTPS_REQUIRED');
  const caption = item.type === 'file' || item.mediaType !== 'audio' ? renderTemplate(item.caption ?? '', context).trim() || null : null;
  if (item.type === 'file') return { type: 'DOCUMENT', body: caption, mediaUrl, providerPayload: { kind: 'file', fileName: renderTemplate(item.fileName, context).trim() } };
  if (item.mediaType === 'audio') return { type: 'AUDIO', body: null, mediaUrl, providerPayload: { kind: 'audio', ptt: item.ptt === true } };
  return { type: item.mediaType === 'video' ? 'VIDEO' : 'IMAGE', body: caption, mediaUrl, providerPayload: {} };
}
