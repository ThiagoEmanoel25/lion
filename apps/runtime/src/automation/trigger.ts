import { AutomationDefinitionSchema } from '@nexo/contracts';

export function matchesAutomationTrigger(definition: unknown, event: string, tagId?: string) {
  const parsed = AutomationDefinitionSchema.safeParse(definition);
  if (!parsed.success) return false;
  const start = parsed.data.nodes.find(node => node.id === parsed.data.start);
  if (start?.kind !== 'trigger' || String(start.config.event ?? 'message.received') !== event) return false;
  return event !== 'tag.added' || typeof start.config.tagId !== 'string' || start.config.tagId === tagId;
}

export function isOncePerContact(definition: unknown) {
  const parsed = AutomationDefinitionSchema.safeParse(definition);
  const start = parsed.success ? parsed.data.nodes.find(node => node.id === parsed.data.start) : undefined;
  return start?.kind === 'trigger' && start.config.oncePerContact === true;
}

export const shouldStartForContact = (oncePerContact: boolean, hasPriorExecution: boolean) => !(oncePerContact && hasPriorExecution);

// A paused playbook keeps its active version (running executions continue) but takes no new entrants.
export const acceptsNewEntrants = (status: string) => status !== 'PAUSED';
