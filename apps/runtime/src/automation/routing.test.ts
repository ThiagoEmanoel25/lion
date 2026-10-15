import { describe, expect, it } from 'vitest';
import { conditionMatches, getPathValue, menuTimeoutSeconds, renderTemplate, resolveMenuChoice, routesByChoice, selectNextEdge, type AutomationNode, type AutomationEdge } from './routing.js';

describe('automation routing', () => {
  it('resolve caminhos aninhados e operadores', () => {
    const context = { contact: { score: 80, tags: ['vip'], name: 'Ana' } };
    expect(getPathValue(context, 'contact.score')).toBe(80);
    expect(conditionMatches(80, { operator: 'greater_than', value: 50 })).toBe(true);
    expect(conditionMatches(['vip'], { operator: 'contains', value: 'vip' })).toBe(true);
    expect(conditionMatches(undefined, { operator: 'not_exists' })).toBe(true);
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

  describe('menu', () => {
    const menu = { id: 'menu', kind: 'buttons', name: 'Menu', position: { x: 0, y: 0 }, config: { text: 'Escolha', buttons: [{ id: 'sales', label: 'Comprar' }, { id: 'help', label: 'Suporte' }] } } as AutomationNode;
    const routed = [
      { id: 'to-sales', source: 'menu', target: 'sales', condition: { field: 'menu.choice', operator: 'equals', value: 'sales' }, isDefault: false, priority: 0 },
      { id: 'to-help', source: 'menu', target: 'help', condition: { field: 'menu.choice', operator: 'equals', value: 'help' }, isDefault: false, priority: 1 },
      { id: 'idle', source: 'menu', target: 'idle', isDefault: true, priority: 2 }
    ] as AutomationEdge[];

    it('roteia pela opção escolhida e usa a padrão para inatividade', () => {
      expect(selectNextEdge(menu, routed, { menu: { choice: 'help' } })?.id).toBe('to-help');
      expect(selectNextEdge(menu, routed, { menu: { timedOut: true } })?.id).toBe('idle');
    });

    it('mantém fluxos antigos de saída única enviando e seguindo', () => {
      const legacy = [{ id: 'next', source: 'menu', target: 'next', isDefault: false, priority: 0 }] as AutomationEdge[];
      expect(routesByChoice(menu, legacy)).toBe(false);
      expect(selectNextEdge(menu, legacy, {})?.id).toBe('next');
      expect(routesByChoice(menu, routed)).toBe(true);
    });

    it('reconhece a escolha por id, texto digitado ou número', () => {
      const options = [{ id: 'sales', label: 'Comprar' }, { id: 'help', label: 'Suporte' }];
      expect(resolveMenuChoice(options, { id: 'help', text: 'Suporte' })?.id).toBe('help');
      expect(resolveMenuChoice(options, { text: '  comprar ' })?.id).toBe('sales');
      expect(resolveMenuChoice(options, { text: '2' })?.id).toBe('help');
      expect(resolveMenuChoice(options, { text: '3' })).toBeNull();
      expect(resolveMenuChoice(options, { text: 'qual o preço?' })).toBeNull();
    });

    it('usa 2 dias quando a expiração é 0 e limita a 31 dias', () => {
      expect(menuTimeoutSeconds(menu)).toBe(172_800);
      expect(menuTimeoutSeconds({ ...menu, config: { ...menu.config, timeoutSeconds: 3_600 } })).toBe(3_600);
      expect(menuTimeoutSeconds({ ...menu, config: { ...menu.config, timeoutSeconds: 99_999_999 } })).toBe(2_678_400);
    });
  });
});
