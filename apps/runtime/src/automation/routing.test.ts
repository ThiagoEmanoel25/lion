import { describe, expect, it } from 'vitest';
import { conditionMatches, getPathValue, renderTemplate, selectNextEdge, type AutomationNode, type AutomationEdge } from './routing.js';

describe('automation routing', () => {
  it('resolve caminhos aninhados e operadores', () => {
    const context = { contact: { score: 80, tags: ['vip'], name: 'Ana' } };
    expect(getPathValue(context, 'contact.score')).toBe(80);
    expect(conditionMatches(80, { field: 'contact.score', operator: 'greater_than', value: 50 })).toBe(true);
    expect(conditionMatches(['vip'], { field: 'contact.tags', operator: 'contains', value: 'vip' })).toBe(true);
    expect(conditionMatches(undefined, { field: 'missing', operator: 'not_exists' })).toBe(true);
  });

  it('escolhe a primeira condição por prioridade', () => {
    const node = { id: 'condition', kind: 'condition' } as AutomationNode;
    const edges = [
      { id: 'default', source: 'condition', target: 'human', isDefault: true, priority: 0 },
      { id: 'low', source: 'condition', target: 'low', condition: { field: 'score', operator: 'greater_than', value: 10 }, priority: 20 },
      { id: 'high', source: 'condition', target: 'high', condition: { field: 'score', operator: 'greater_than', value: 70 }, priority: 10 }
    ] as AutomationEdge[];
    expect(selectNextEdge(node, edges, { score: 90 })?.id).toBe('high');
    expect(selectNextEdge(node, edges, { score: 5 })?.id).toBe('default');
  });

  it('combina regras do bloco e escolhe entre atendida e padrão', () => {
    const node = { id: 'condition', kind: 'condition', name: 'Condicional', position: { x: 0, y: 0 }, config: { logic: 'any', rules: [
      { field: 'contact.stage', operator: 'equals', value: 'qualified' },
      { field: 'contact.tags', operator: 'contains', value: 'vip' }
    ] } } as AutomationNode;
    const edges = [
      { id: 'success', source: 'condition', target: 'message', isDefault: false, priority: 0 },
      { id: 'fallback', source: 'condition', target: 'human', isDefault: true, priority: 1000 }
    ] as AutomationEdge[];
    expect(selectNextEdge(node, edges, { contact: { stage: 'new', tags: ['vip'] } })?.id).toBe('success');
    expect(selectNextEdge(node, edges, { contact: { stage: 'new', tags: [] } })?.id).toBe('fallback');
  });

  it('interpola dados sem executar expressões', () => {
    expect(renderTemplate('Olá {{ contact.name }}, protocolo {{id}}', { contact: { name: 'Ana' }, id: 42 })).toBe('Olá Ana, protocolo 42');
    expect(renderTemplate('{{missing}}', {})).toBe('');
  });
});
