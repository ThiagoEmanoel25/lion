import { AutomationMessageItemSchema, MESSAGE_MAX_ITEMS } from '@nexo/contracts';
import { isIP } from 'node:net';
import type { z } from 'zod';
import { renderTemplate } from './routing.js';

export type SequenceItem = z.output<typeof AutomationMessageItemSchema>;
type SendItem = Exclude<SequenceItem, { type: 'pause' }>;

export function sequenceItems(config: Record<string, unknown>): SequenceItem[] {
  if (Array.isArray(config.items)) {
    if (config.items.length < 1 || config.items.length > MESSAGE_MAX_ITEMS) throw new Error('INVALID_MESSAGE_ITEM_COUNT');
    return config.items.map(raw => {
      const parsed = AutomationMessageItemSchema.safeParse(raw);
      if (!parsed.success) throw new Error('INVALID_MESSAGE_ITEM');
      return parsed.data;
    });
  }
  return typeof config.text === 'string' && config.text.trim() ? [{ type: 'text', text: config.text, typingSeconds: 0 }] : [];
}

export const pauseSeconds = (item: { minSeconds: number; maxSeconds: number }, random: () => number = Math.random): number =>
  item.minSeconds + Math.floor(Math.min(Math.max(random(), 0), 1 - Number.EPSILON) * (item.maxSeconds - item.minSeconds + 1));

const privateIpv4 = (hostname: string): boolean => {
  const parts = hostname.split('.').map(Number);
  const [a, b] = parts;
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b! >= 64 && b! <= 127)
    || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19)) || a! >= 224;
};

// Rejects direct access to local/private services. Hostname DNS is still resolved by Baileys,
// so deployments should additionally restrict the runtime's egress at the network boundary.
export function safeMediaUrl(value: string): string {
  if (value.length > 2048) throw new Error('MEDIA_URL_TOO_LONG');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('MEDIA_HTTPS_REQUIRED'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('MEDIA_HTTPS_REQUIRED');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) throw new Error('MEDIA_PRIVATE_HOST');
  const ipVersion = isIP(hostname);
  if (ipVersion === 4 && privateIpv4(hostname)) throw new Error('MEDIA_PRIVATE_HOST');
  if (ipVersion === 6 && (hostname === '::' || hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('::ffff:') || /^fe[89ab]/.test(hostname))) throw new Error('MEDIA_PRIVATE_HOST');
  return url.toString();
}

export function itemMessage(item: SendItem, context: Record<string, unknown>): { type: 'TEXT' | 'DOCUMENT' | 'IMAGE' | 'VIDEO' | 'AUDIO'; body: string | null; mediaUrl: string | null; providerPayload: Record<string, unknown> } {
  if (item.type === 'text') {
    const body = renderTemplate(item.text, context).trim();
    if (!body) throw new Error('EMPTY_MESSAGE');
    if (body.length > 4096) throw new Error('MESSAGE_TOO_LONG');
    return { type: 'TEXT', body, mediaUrl: null, providerPayload: item.typingSeconds > 0 ? { typingSeconds: item.typingSeconds } : {} };
  }
  const mediaUrl = safeMediaUrl(renderTemplate(item.url, context).trim());
  const caption = item.type === 'file' || item.mediaType !== 'audio' ? renderTemplate(item.caption ?? '', context).trim() || null : null;
  if (caption && caption.length > 1024) throw new Error('CAPTION_TOO_LONG');
  if (item.type === 'file') {
    const fileName = renderTemplate(item.fileName, context).trim();
    if (!fileName) throw new Error('EMPTY_FILE_NAME');
    if (fileName.length > 255) throw new Error('FILE_NAME_TOO_LONG');
    return { type: 'DOCUMENT', body: caption, mediaUrl, providerPayload: { kind: 'file', fileName } };
  }
  if (item.mediaType === 'audio') return { type: 'AUDIO', body: null, mediaUrl, providerPayload: { kind: 'audio', ptt: item.ptt === true } };
  return { type: item.mediaType === 'video' ? 'VIDEO' : 'IMAGE', body: caption, mediaUrl, providerPayload: {} };
}

export type SequenceRef = { executionId: string; stepId: string; index: number };

export function sequenceOf(providerPayload: unknown): SequenceRef | undefined {
  const sequence = providerPayload && typeof providerPayload === 'object' && !Array.isArray(providerPayload) ? (providerPayload as { sequence?: Partial<SequenceRef> }).sequence : undefined;
  return sequence && typeof sequence.executionId === 'string' && sequence.executionId.length > 0 && typeof sequence.stepId === 'string' && sequence.stepId.length > 0 && Number.isInteger(sequence.index) && sequence.index! >= 0 ? { executionId: sequence.executionId, stepId: sequence.stepId, index: sequence.index! } : undefined;
}

// Fixed jobId per (step, next index): the engine (pause) and the outbound worker (sent/failed, retries) can never schedule the same continuation twice.
export const sequenceJobOptions = (stepId: string, index: number, delay = 0) => ({ jobId: `automation-seq-${stepId}-${index}`, delay, attempts: 5, backoff: { type: 'exponential', delay: 1_000 }, removeOnComplete: 1_000, removeOnFail: 5_000 });
