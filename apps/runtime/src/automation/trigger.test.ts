import { describe, expect, it } from 'vitest';
import { matchesAutomationTrigger } from './trigger.js';

const definition = (event: string, tagId?: string) => ({
  start: 'start',
  nodes: [
    { id: 'start', kind: 'trigger', name: 'Início', config: { event, ...(tagId ? { tagId } : {}) }, position: { x: 0, y: 0 } },
    { id: 'end', kind: 'outcome', name: 'Fim', config: { type: 'RESOLVED' }, position: { x: 100, y: 0 } }
  ],
  edges: [{ id: 'edge', source: 'start', target: 'end' }],
  settings: { maxSteps: 10, timeoutSeconds: 60 }
});

describe('automation trigger matching', () => {
  it('só aceita o evento configurado', () => {
    expect(matchesAutomationTrigger(definition('conversation.created'), 'conversation.created')).toBe(true);
    expect(matchesAutomationTrigger(definition('conversation.created'), 'message.received')).toBe(false);
  });

  it('respeita filtro opcional de etiqueta', () => {
    expect(matchesAutomationTrigger(definition('tag.added', 'tag-1'), 'tag.added', 'tag-1')).toBe(true);
    expect(matchesAutomationTrigger(definition('tag.added', 'tag-1'), 'tag.added', 'tag-2')).toBe(false);
    expect(matchesAutomationTrigger(definition('tag.added'), 'tag.added', 'tag-2')).toBe(true);
  });
});
