import { systemContext } from '@nexo/contracts';

export const WINDOW_24H_MS = 86_400_000;

export type LiveSnapshot = {
  timeZone: string;
  now: Date;
  contact: { id: string; name: string | null; phone: string; email: string | null; stage: string; customFields: unknown; tags: Array<{ id: string; name: string }> };
  conversation: { id: string; status: string; mode: string; assigneeId: string | null; queue: string | null };
  lastInboundAt: Date | null;
};

// Conditions read the conversation as it is now, not as it was when the execution started.
export function firstName(name: string | null): string { return name?.trim().split(/\s+/)[0] ?? ''; }

export function liveConditionContext(snapshot: LiveSnapshot) {
  return {
    contact: { ...snapshot.contact, firstName: firstName(snapshot.contact.name), tagIds: snapshot.contact.tags.map(tag => tag.id) } as Record<string, unknown>,
    conversation: {
      ...snapshot.conversation,
      window24h: snapshot.lastInboundAt !== null && snapshot.now.getTime() - snapshot.lastInboundAt.getTime() < WINDOW_24H_MS
    } as Record<string, unknown>,
    system: systemContext(snapshot.now, snapshot.timeZone)
  };
}

const objectOf = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function mergeLiveContext<T extends Record<string, unknown>>(context: T, live: ReturnType<typeof liveConditionContext>): T {
  return {
    ...context,
    contact: { ...objectOf(context.contact), ...live.contact },
    conversation: { ...objectOf(context.conversation), ...live.conversation },
    system: live.system
  };
}
