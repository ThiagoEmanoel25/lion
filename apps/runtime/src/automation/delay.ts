import { nextDelayAt, normalizeDelayConfig, type DelayMode } from '@nexo/domain';

/** Resolves when a delay block resumes. Throws the domain's pt-BR message when the config is invalid. */
export function planDelay(config: unknown, now: Date, workspaceTimezone: string): { at: Date; mode: DelayMode; delayMs: number; scheduledFor: string } {
  const { at, mode } = nextDelayAt(normalizeDelayConfig(config), now, workspaceTimezone);
  return { at, mode, delayMs: Math.max(0, at.getTime() - now.getTime()), scheduledFor: at.toISOString() };
}
