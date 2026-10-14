import { describe, expect, it } from 'vitest';
import { simulateAutomation, validateAutomation } from './compiler.js';

const validDefinition = {
  start: 'start',
  nodes: [
    { id: 'start', kind: 'trigger', name: 'Início', config: {}, position: { x: 0, y: 0 } },
    { id: 'condition', kind: 'condition', name: 'É cliente?', config: {}, position: { x: 100, y: 0 } },
    { id: 'yes', kind: 'message', name: 'Boas-vindas', config: { text: 'Bem-vindo de volta!' }, position: { x: 200, y: -50 } },
    { id: 'done', kind: 'outcome', name: 'Concluído', config: { type: 'RESOLVED' }, position: { x: 300, y: -50 } },
    { id: 'human', kind: 'handoff', name: 'Atendimento', config: {}, position: { x: 200, y: 50 } }
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'condition' },
    { id: 'e2', source: 'condition', target: 'yes', condition: { field: 'contact.customer', operator: 'equals', value: true }, priority: 0 },
    { id: 'e3', source: 'condition', target: 'human', isDefault: true },
    { id: 'e4', source: 'yes', target: 'done' }
  ],
  settings: { maxSteps: 10, timeoutSeconds: 60 }
};

describe('validateAutomation', () => {
  it('aceita um grafo determinístico e alcançável', () => {
    const result = validateAutomation(validDefinition);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejeita ids duplicados, início inválido e saída ambígua', () => {
    const result = validateAutomation({
      ...validDefinition,
      start: 'yes',
      nodes: [...validDefinition.nodes, { ...validDefinition.nodes[2] }],
      edges: [...validDefinition.edges, { id: 'extra', source: 'start', target: 'human' }]
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['DUPLICATE_NODE_ID', 'START_MUST_BE_TRIGGER', 'AMBIGUOUS_OUTPUT']));
  });

  it('valida configurações obrigatórias por tipo de nó', () => {
    const definition = structuredClone(validDefinition);
    definition.nodes[2]!.config = {};
    const result = validateAutomation(definition);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'MESSAGE_TEXT_REQUIRED', nodeId: 'yes' }));
  });
});

describe('simulateAutomation', () => {
  it('seleciona a condição correspondente', () => {
    const validation = validateAutomation(validDefinition);
    if (!validation.definition) throw new Error('fixture inválida');
    const simulation = simulateAutomation(validation.definition, { contact: { customer: true } });
    expect(simulation.path).toEqual(['start', 'condition', 'yes', 'done']);
    expect(simulation.stoppedBecause).toBe('completed');
  });

  it('usa a saída padrão quando nenhuma condição casa', () => {
    const validation = validateAutomation(validDefinition);
    if (!validation.definition) throw new Error('fixture inválida');
    const simulation = simulateAutomation(validation.definition, { contact: { customer: false } });
    expect(simulation.path).toEqual(['start', 'condition', 'human']);
  });

  it('interrompe ciclos pelo limite de passos', () => {
    const cycle = {
      start: 'start',
      nodes: [
        { id: 'start', kind: 'trigger', name: 'Início', config: {}, position: { x: 0, y: 0 } },
        { id: 'loop', kind: 'message', name: 'Loop', config: { text: 'oi' }, position: { x: 1, y: 0 } },
        { id: 'end', kind: 'outcome', name: 'Fim', config: { type: 'RESOLVED' }, position: { x: 2, y: 0 } }
      ],
      edges: [{ id: 'e1', source: 'start', target: 'loop' }, { id: 'e2', source: 'loop', target: 'start' }],
      settings: { maxSteps: 4, timeoutSeconds: 60 }
    };
    const validation = validateAutomation(cycle);
    if (!validation.definition) throw new Error('fixture inválida');
    const simulation = simulateAutomation(validation.definition);
    expect(simulation.path).toHaveLength(4);
    expect(simulation.stoppedBecause).toBe('max_steps');
  });
});
