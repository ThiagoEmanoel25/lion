import { WAIT_MAX_BUFFER_SECONDS, WAIT_MAX_SECONDS, WAIT_UNIT_SECONDS } from '@nexo/contracts';

export type PendingWait = { stepId: string; nodeId: string; kind: 'menu' | 'reply'; since?: string };

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

// Legacy runtimes stored `pendingMenu`; it is read back as a menu wait.
export function pendingWaitOf(runtime: unknown): PendingWait | undefined {
  const state = record(runtime);
  const wait = record(state?.pendingWait);
  if (wait && typeof wait.stepId === 'string' && typeof wait.nodeId === 'string' && (wait.kind === 'menu' || wait.kind === 'reply')) {
    return typeof wait.since === 'string'
      ? { stepId: wait.stepId, nodeId: wait.nodeId, kind: wait.kind, since: wait.since }
      : { stepId: wait.stepId, nodeId: wait.nodeId, kind: wait.kind };
  }
  const legacy = record(state?.pendingMenu);
  if (legacy && typeof legacy.stepId === 'string' && typeof legacy.nodeId === 'string') {
    return { stepId: legacy.stepId, nodeId: legacy.nodeId, kind: 'menu' };
  }
  return undefined;
}

export function waitTimeoutSeconds(config: Record<string, unknown>): { seconds: number; endsWithoutTimeoutRoute: boolean } {
  const unit = config.timeoutUnit;
  const value = config.timeoutValue;
  const valid = typeof value === 'number' && Number.isFinite(value) && value > 0
    && typeof unit === 'string' && Object.prototype.hasOwnProperty.call(WAIT_UNIT_SECONDS, unit);
  if (config.waitIndefinitely === true || !valid) return { seconds: WAIT_MAX_SECONDS, endsWithoutTimeoutRoute: true };
  return { seconds: Math.min(value * WAIT_UNIT_SECONDS[unit as keyof typeof WAIT_UNIT_SECONDS], WAIT_MAX_SECONDS), endsWithoutTimeoutRoute: false };
}

export function waitBufferSeconds(config: Record<string, unknown>): number {
  const value = config.bufferSeconds;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= WAIT_MAX_BUFFER_SECONDS ? value : 0;
}

export function joinReplies(messages: Array<{ body: string | null; type: string }>): { last_message: string; last_message_type: string } {
  const bodies = messages.flatMap(message => message.body ? [message.body] : []);
  const last = messages[messages.length - 1];
  return { last_message: bodies.join('\n'), last_message_type: last?.type ?? 'TEXT' };
}

export function waitReplyActions(config:{saveReplyTo?:string;saveEmpty:boolean;reactEmoji?:string;replyToLeadCount:number},reply:{last_message:string},latest:{id:string;externalId:string|null}){
  return {
    ...(config.saveReplyTo&&(config.saveEmpty||reply.last_message.length>0)?{saveReply:{field:config.saveReplyTo,value:reply.last_message}}:{}),
    ...(config.replyToLeadCount>0?{quoteNext:{messageId:latest.id,remaining:config.replyToLeadCount}}:{}),
    ...(config.reactEmoji&&latest.externalId?{reaction:{emoji:config.reactEmoji,messageExternalId:latest.externalId}}:{})
  };
}

// A wait_response buffer already joined the reply into last_message; keep it while the latest message is one of those joined.
export function aiLastMessage(context: Record<string, unknown>, latest: { id: string; body: string | null } | null): string {
  const ids = record(context.wait)?.messageIds;
  if (latest && Array.isArray(ids) && ids.includes(latest.id) && typeof context.last_message === 'string') return context.last_message;
  return latest?.body ?? '';
}
