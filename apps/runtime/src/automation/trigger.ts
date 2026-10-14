import { AutomationDefinitionSchema } from '@nexo/contracts';

export function matchesAutomationTrigger(definition: unknown, event: string, tagId?: string) {
  const parsed = AutomationDefinitionSchema.safeParse(definition);
  if (!parsed.success) return false;
  const start = parsed.data.nodes.find(node => node.id === parsed.data.start);
  if (start?.kind !== 'trigger' || String(start.config.event ?? 'message.received') !== event) return false;
  return event !== 'tag.added' || typeof start.config.tagId !== 'string' || start.config.tagId === tagId;
}
