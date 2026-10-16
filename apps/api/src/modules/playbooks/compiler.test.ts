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

  it('aceita imagem, áudio, figurinha e botões com configuração segura', () => {
    const mediaNodes = [
      { id: 'image', kind: 'image', name: 'Imagem', config: { url: 'https://cdn.test/image.jpg', caption: 'Olá {{contact.name}}' }, position: { x: 100, y: 0 } },
      { id: 'audio', kind: 'audio', name: 'Áudio', config: { url: 'https://cdn.test/audio.ogg', ptt: true }, position: { x: 200, y: 0 } },
      { id: 'sticker', kind: 'sticker', name: 'Figurinha', config: { url: 'https://cdn.test/sticker.webp' }, position: { x: 300, y: 0 } },
      { id: 'buttons', kind: 'buttons', name: 'Botões', config: { text: 'Escolha', buttons: [{ id: 'yes', label: 'Sim' }, { id: 'no', label: 'Não' }] }, position: { x: 400, y: 0 } }
    ];
    const definition = {
      start: 'start',
      nodes: [validDefinition.nodes[0], ...mediaNodes, validDefinition.nodes[3]],
      edges: [
        { id: 'm1', source: 'start', target: 'image' },
        { id: 'm2', source: 'image', target: 'audio' },
        { id: 'm3', source: 'audio', target: 'sticker' },
        { id: 'm4', source: 'sticker', target: 'buttons' },
        { id: 'm5', source: 'buttons', target: 'done' }
      ],
      settings: { maxSteps: 10, timeoutSeconds: 60 }
    };
    expect(validateAutomation(definition).valid).toBe(true);
  });

  it('rejeita mídia sem HTTPS e botões duplicados', () => {
    const definition = structuredClone(validDefinition);
    const baseNode = definition.nodes[2]!;
    definition.nodes[2] = { ...baseNode, kind: 'buttons', config: { text: 'Escolha', buttons: [{ id: 'same', label: 'Sim' }, { id: 'same', label: 'Sim' }] } } as never;
    const buttons = validateAutomation(definition);
    expect(buttons.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_BUTTONS_CONFIG', nodeId: 'yes' }));
    definition.nodes[2] = { ...baseNode, kind: 'image', config: { url: 'http://cdn.test/image.jpg' } } as never;
    const image = validateAutomation(definition);
    expect(image.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_IMAGE_CONFIG', nodeId: 'yes' }));
  });

  it('valida os recursos compatíveis de etiquetas, intervalo e integração', () => {
    const definition = structuredClone(validDefinition);
    const configurable = definition.nodes[2]!;

    definition.nodes[2] = { ...configurable, kind: 'tag', config: { mode: 'remove', tags: ['vip', 'retorno'], tagIds: [] } } as never;
    expect(validateAutomation(definition).valid).toBe(true);

    definition.nodes[2] = { ...configurable, kind: 'delay', config: { seconds: 2_678_400, unit: 'days' } } as never;
    expect(validateAutomation(definition).valid).toBe(true);

    definition.nodes[2] = { ...configurable, kind: 'webhook', config: { url: 'https://api.test/events', method: 'PUT', headers: { authorization: 'Bearer {{token}}' }, body: '{"name":"{{contact.name}}"}', responseVariable: 'integration.response' } } as never;
    expect(validateAutomation(definition).valid).toBe(true);
  });

  it('rejeita intervalo acima de 31 dias e etiquetas vazias', () => {
    const definition = structuredClone(validDefinition);
    const configurable = definition.nodes[2]!;
    definition.nodes[2] = { ...configurable, kind: 'delay', config: { seconds: 2_678_401, unit: 'days' } } as never;
    expect(validateAutomation(definition).issues).toContainEqual(expect.objectContaining({ code: 'INVALID_DELAY', nodeId: 'yes' }));
    definition.nodes[2] = { ...configurable, kind: 'tag', config: { mode: 'add', tags: [], tagIds: [] } } as never;
    expect(validateAutomation(definition).issues).toContainEqual(expect.objectContaining({ code: 'TAG_REQUIRED', nodeId: 'yes' }));
  });

  it('executa regras E/OU configuradas dentro do bloco condicional', () => {
    const definition = structuredClone(validDefinition);
    definition.nodes[1]!.config = { logic: 'all', rules: [
      { field: 'contact.stage', operator: 'equals', value: 'qualified' },
      { field: 'contact.tags', operator: 'contains', value: 'vip' }
    ] } as never;
    definition.edges[1] = { id: 'e2', source: 'condition', target: 'yes', label: 'Condição atendida', priority: 0 } as never;
    const validation = validateAutomation(definition);
    expect(validation.valid).toBe(true);
    if (!validation.definition) throw new Error('fixture inválida');
    expect(simulateAutomation(validation.definition, { contact: { stage: 'qualified', tags: ['vip'] } }).path).toEqual(['start', 'condition', 'yes', 'done']);
    expect(simulateAutomation(validation.definition, { contact: { stage: 'qualified', tags: [] } }).path).toEqual(['start', 'condition', 'human']);
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

describe('menu com saída por opção', () => {
  const menuDefinition = (edges: Array<Record<string, unknown>>) => ({
    start: 'start',
    nodes: <Array<Record<string, unknown> & { config: Record<string, unknown> }>>[
      { id: 'start', kind: 'trigger', name: 'Início', config: {}, position: { x: 0, y: 0 } },
      { id: 'menu', kind: 'buttons', name: 'Menu', config: { mode: 'list', text: 'Escolha', buttonText: 'Ver opções', buttons: [{ id: 'sales', label: 'Comprar' }, { id: 'help', label: 'Suporte' }] }, position: { x: 100, y: 0 } },
      { id: 'won', kind: 'outcome', name: 'Venda', config: { type: 'SALE' }, position: { x: 200, y: -50 } },
      { id: 'human', kind: 'handoff', name: 'Suporte', config: {}, position: { x: 200, y: 50 } },
      { id: 'idle', kind: 'outcome', name: 'Sem resposta', config: { type: 'DISQUALIFIED' }, position: { x: 200, y: 100 } }
    ],
    edges: [{ id: 'e0', source: 'start', target: 'menu' }, ...edges],
    settings: { maxSteps: 10, timeoutSeconds: 60 }
  });
  const choice = (value: string) => ({ field: 'menu.choice', operator: 'equals', value });

  it('aceita uma saída por opção e uma por inatividade', () => {
    const result = validateAutomation(menuDefinition([
      { id: 'to-sales', source: 'menu', target: 'won', condition: choice('sales'), priority: 0 },
      { id: 'to-help', source: 'menu', target: 'human', condition: choice('help'), priority: 1 },
      { id: 'to-idle', source: 'menu', target: 'idle', isDefault: true, priority: 2 }
    ]));
    expect(result.issues.filter(issue => issue.level === 'error')).toEqual([]);
  });

  it('exige saída para toda opção e só aceita opções existentes', () => {
    const result = validateAutomation(menuDefinition([
      { id: 'to-sales', source: 'menu', target: 'won', condition: choice('sales'), priority: 0 },
      { id: 'ghost', source: 'menu', target: 'human', condition: choice('nope'), priority: 1 },
      { id: 'idle-a', source: 'menu', target: 'idle', isDefault: true, priority: 2 },
      { id: 'idle-b', source: 'menu', target: 'human', isDefault: true, priority: 3 }
    ]));
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['MENU_ROUTE_INVALID', 'MENU_OPTION_UNROUTED', 'MENU_TIMEOUT_DUPLICATE']));
  });

  it('simula pela escolha informada ou pela primeira opção', () => {
    const definition = validateAutomation(menuDefinition([
      { id: 'to-sales', source: 'menu', target: 'won', condition: choice('sales'), priority: 0 },
      { id: 'to-help', source: 'menu', target: 'human', condition: choice('help'), priority: 1 }
    ])).definition!;
    expect(simulateAutomation(definition, { menu: { choice: 'help' } }).path).toEqual(['start', 'menu', 'human']);
    expect(simulateAutomation(definition).path).toEqual(['start', 'menu', 'won']);
  });

  it('aceita imagem HTTPS só no formato botões', () => {
    const withImage = (mode: string, imageUrl: string) => {
      const definition = menuDefinition([{ id: 'e1', source: 'menu', target: 'won' }]);
      definition.nodes[1] = { ...definition.nodes[1]!, config: { mode, text: 'Escolha', buttonText: 'Ver', imageUrl, buttons: [{ id: 'a', label: 'A' }] } };
      return validateAutomation(definition).issues.map(issue => issue.code);
    };
    expect(withImage('buttons', 'https://cdn.test/capa.jpg')).not.toContain('INVALID_BUTTONS_CONFIG');
    expect(withImage('buttons', 'http://cdn.test/capa.jpg')).toContain('INVALID_BUTTONS_CONFIG');
    expect(withImage('list', 'https://cdn.test/capa.jpg')).toContain('INVALID_BUTTONS_CONFIG');
  });

  it('rejeita lista sem texto do botão e botões acima de 3', () => {
    const tooMany = menuDefinition([{ id: 'e1', source: 'menu', target: 'won' }]);
    tooMany.nodes[1] = { ...tooMany.nodes[1]!, config: { mode: 'buttons', text: 'Escolha', buttons: [1, 2, 3, 4].map(n => ({ id: `b${n}`, label: `B${n}` })) } };
    const noButtonText = menuDefinition([{ id: 'e1', source: 'menu', target: 'won' }]);
    noButtonText.nodes[1] = { ...noButtonText.nodes[1]!, config: { mode: 'list', text: 'Escolha', buttons: [{ id: 'a', label: 'A' }] } };
    expect(validateAutomation(tooMany).issues.map(issue => issue.code)).toContain('INVALID_BUTTONS_CONFIG');
    expect(validateAutomation(noButtonText).issues.map(issue => issue.code)).toContain('INVALID_BUTTONS_CONFIG');
  });
});

describe('portas de sucesso e erro', () => {
  const ported = (edges: Array<Record<string, unknown>>) => ({
    start: 'start',
    nodes: [
      { id: 'start', kind: 'trigger', name: 'Início', config: {}, position: { x: 0, y: 0 } },
      { id: 'api', kind: 'webhook', name: 'Integração', config: { url: 'https://api.test/x' }, position: { x: 100, y: 0 } },
      { id: 'ok', kind: 'outcome', name: 'Ok', config: { type: 'RESOLVED' }, position: { x: 200, y: 0 } },
      { id: 'bad', kind: 'handoff', name: 'Erro', config: {}, position: { x: 200, y: 100 } }
    ],
    edges: [{ id: 'e0', source: 'start', target: 'api' }, ...edges],
    settings: { maxSteps: 10, timeoutSeconds: 60 }
  });

  it('aceita sucesso e erro, e conexão antiga sem porta', () => {
    expect(validateAutomation(ported([{ id: 's', source: 'api', target: 'ok', port: 'success' }, { id: 'f', source: 'api', target: 'bad', port: 'failure' }])).valid).toBe(true);
    expect(validateAutomation(ported([{ id: 's', source: 'api', target: 'ok' }])).valid).toBe(true);
  });

  it('rejeita porta repetida, porta inexistente e falta de sucesso', () => {
    const codes = (edges: Array<Record<string, unknown>>) => validateAutomation(ported(edges)).issues.map(issue => issue.code);
    expect(codes([{ id: 's', source: 'api', target: 'ok' }, { id: 's2', source: 'api', target: 'bad', port: 'success' }])).toContain('PORT_DUPLICATE_ROUTE');
    expect(codes([{ id: 's', source: 'api', target: 'ok', port: 'reply' }])).toContain('EDGE_PORT_INVALID');
    expect(codes([{ id: 'f', source: 'api', target: 'bad', port: 'failure' }])).toContain('SUCCESS_ROUTE_REQUIRED');
    expect(codes([{ id: 's', source: 'start', target: 'ok', port: 'success' }])).toContain('EDGE_PORT_INVALID');
  });

  it('permite sucesso e erro para o mesmo destino', () => {
    const result = validateAutomation(ported([{ id: 's', source: 'api', target: 'ok', port: 'success' }, { id: 'f', source: 'api', target: 'ok', port: 'failure' }]));
    expect(result.issues.map(issue => issue.code)).not.toContain('DUPLICATE_CONNECTION');
    expect(result.valid).toBe(true);
  });

  it('valida a config do bloco de IA', () => {
    const definition = ported([{ id: 's', source: 'api', target: 'ok' }]);
    definition.nodes[1] = { ...definition.nodes[1]!, kind: 'ai', config: { systemPrompt: '' } } as never;
    expect(validateAutomation(definition).issues.map(issue => issue.code)).toContain('INVALID_AI_CONFIG');
  });

  it('simula seguindo a porta de sucesso', () => {
    const { definition } = validateAutomation(ported([{ id: 'f', source: 'api', target: 'bad', port: 'failure' }, { id: 's', source: 'api', target: 'ok', port: 'success' }]));
    expect(simulateAutomation(definition!).path).toEqual(['start', 'api', 'ok']);
  });
});
