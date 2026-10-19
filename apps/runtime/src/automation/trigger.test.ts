import { describe, expect, it } from 'vitest';
import { acceptsNewEntrants, isOncePerContact, matchesAutomationTrigger, shouldStartForContact } from './trigger.js';

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

describe('run once per contact', () => {
  const withFlag = (oncePerContact?: boolean) => ({ ...definition('message.received'), nodes: [{ ...definition('message.received').nodes[0]!, config: { event: 'message.received', ...(oncePerContact === undefined ? {} : { oncePerContact }) } }, definition('x').nodes[1]!] });
  it('lê a opção do gatilho inicial', () => {
    expect(isOncePerContact(withFlag(true))).toBe(true);
    expect(isOncePerContact(withFlag(false))).toBe(false);
    expect(isOncePerContact(withFlag())).toBe(false);
    expect(isOncePerContact({})).toBe(false);
  });
  it('só bloqueia quem já passou pelo fluxo', () => {
    expect(shouldStartForContact(true, true)).toBe(false);
    expect(shouldStartForContact(true, false)).toBe(true);
    expect(shouldStartForContact(false, true)).toBe(true);
  });
});

describe('pause', () => {
  it('fluxo pausado não recebe novas entradas', () => {
    expect(acceptsNewEntrants('PAUSED')).toBe(false);
    expect(acceptsNewEntrants('PUBLISHED')).toBe(true);
  });
});
