import { afterEach, describe, expect, it } from 'vitest';
import { createSimulation, SIMULATION_MAX_MESSAGES, SIMULATION_MAX_STEPS, stepSimulation, type SimulationDefinition, type SimulationState } from './simulation.js';
import type { FlowEdge, FlowNode } from './routing.js';
import { readFileSync } from 'node:fs';

const node = (id: string, kind: string, config: Record<string, unknown> = {}): FlowNode => ({ id, kind, name: id, config });
const edge = (id: string, source: string, target: string, extra: Partial<FlowEdge> = {}): FlowEdge => ({ id, source, target, priority: 0, ...extra });
const flow = (start: string, nodes: FlowNode[], edges: FlowEdge[]): SimulationDefinition => ({ start, nodes, edges });

const FROZEN = new Date('2026-10-22T12:00:00.000Z');
const clock = { now: () => FROZEN };

const texts = (state: SimulationState) => state.messages.map(message => message.text);
const start = (definition: SimulationDefinition, variables: Record<string, unknown> = {}) =>
  stepSimulation(createSimulation(definition, variables), { kind: 'start' }, clock);

describe('menu', () => {
  const definition = flow('t', [
    node('t', 'trigger'),
    node('m', 'buttons', { text: 'Olá {{contact.name}}, escolha', buttons: [{ id: 'a', label: 'Comprar' }, { id: 'b', label: 'Suporte' }], saveAs: 'escolha' }),
    node('buy', 'message', { text: 'Vamos vender' }),
    node('help', 'message', { text: 'Chamando o suporte' })
  ], [
    edge('e1', 't', 'm'),
    edge('e2', 'm', 'buy', { condition: { field: 'menu.choice', operator: 'equals', value: 'a' } }),
    edge('e3', 'm', 'help', { condition: { field: 'menu.choice', operator: 'equals', value: 'b' } })
  ]);

  it('espera a escolha e segue pela opção clicada', () => {
    const waiting = start(definition, { contact: { name: 'Ana' } });
    expect(waiting.waiting).toEqual({ kind: 'choice', nodeId: 'm', options: [{ id: 'a', label: 'Comprar' }, { id: 'b', label: 'Suporte' }], canTimeout: true });
    expect(texts(waiting)).toContain('Olá Ana, escolha');
    expect(waiting.completed).toBe(false);

    const chosen = stepSimulation(waiting, { kind: 'choice', optionId: 'b' }, clock);
    expect(texts(chosen)).toContain('Chamando o suporte');
    expect(chosen.context).toMatchObject({ menu: { choice: 'b', label: 'Suporte', timedOut: false }, escolha: 'Suporte' });
    expect(chosen.visitedNodeIds).toEqual(['t', 'm', 'help']);
    expect(chosen.completed).toBe(true);
  });

  it('aceita a opção digitada pelo número e ignora texto fora do menu', () => {
    const waiting = start(definition);
    const ignored = stepSimulation(waiting, { kind: 'reply', text: 'oi?' }, clock);
    expect(ignored.waiting?.kind).toBe('choice');
    const typed = stepSimulation(ignored, { kind: 'reply', text: '1' }, clock);
    expect(texts(typed)).toContain('Vamos vender');
    expect(typed.completed).toBe(true);
  });

  it('advance usa a saída de inatividade do menu', () => {
    const withDefault = flow('m', [definition.nodes[1]!, node('bye', 'message', { text: 'Ficamos por aqui' })], [edge('d', 'm', 'bye', { isDefault: true })]);
    const timedOut = stepSimulation(start(withDefault), { kind: 'advance' }, clock);
    expect(timedOut.context).toMatchObject({ menu: { timedOut: true } });
    expect(texts(timedOut)).toContain('Ficamos por aqui');
  });
});

describe('aguarda resposta', () => {
  const definition = flow('w', [
    node('w', 'wait_response', { message: 'Qual seu nome?', saveReplyTo: 'nome', timeoutValue: 1, timeoutUnit: 'hours' }),
    node('ok', 'message', { text: 'Oi {{contact.customFields.nome}}' }),
    node('late', 'message', { text: 'Ninguém respondeu' })
  ], [
    edge('r', 'w', 'ok', { port: 'reply' }),
    edge('t', 'w', 'late', { port: 'timeout' })
  ]);

  it('segue pela saída de resposta e guarda a resposta só no contexto', () => {
    const waiting = start(definition);
    expect(waiting.waiting).toEqual({ kind: 'reply', nodeId: 'w', canTimeout: true });
    expect(texts(waiting)).toEqual(['Qual seu nome?']);
    const replied = stepSimulation(waiting, { kind: 'reply', text: 'Ana' }, clock);
    expect(texts(replied)).toContain('Oi Ana');
    expect(replied.context).toMatchObject({ last_message: 'Ana', last_message_type: 'TEXT', contact: { customFields: { nome: 'Ana' } } });
  });

  it('advance segue pela saída de quem não respondeu', () => {
    const timedOut = stepSimulation(start(definition), { kind: 'advance' }, clock);
    expect(texts(timedOut)).toContain('Ninguém respondeu');
    expect(timedOut.completed).toBe(true);
  });

  it('não oferece timeout quando a espera é indefinida', () => {
    const indefinite = flow('w', [node('w', 'wait_response', { waitIndefinitely: true })], [edge('t', 'w', 'w', { port: 'timeout' })]);
    const waiting = start(indefinite);
    expect(waiting.waiting).toEqual({ kind: 'reply', nodeId: 'w', canTimeout: false });
    expect(stepSimulation(waiting, { kind: 'advance' }, clock)).toBe(waiting);
  });
});

describe('condicional', () => {
  const definition = flow('c', [
    node('c', 'condition', { logic: 'all', rules: [{ field: 'contact.score', operator: 'greater_than', value: 50 }] }),
    node('vip', 'message', { text: 'Atendimento VIP' }),
    node('normal', 'message', { text: 'Atendimento padrão' })
  ], [
    edge('yes', 'c', 'vip'),
    edge('no', 'c', 'normal', { isDefault: true })
  ]);

  it('percorre os dois caminhos conforme o contexto', () => {
    expect(texts(start(definition, { contact: { score: 80 } }))).toContain('Atendimento VIP');
    expect(texts(start(definition, { contact: { score: 10 } }))).toContain('Atendimento padrão');
  });
});

describe('delay', () => {
  const definition = flow('d', [
    node('d', 'delay', { mode: 'duration', duration: 2, unit: 'hours' }),
    node('after', 'message', { text: 'Depois da espera' })
  ], [edge('e', 'd', 'after')]);

  it('aguarda com o horário calculado pelo relógio injetado e advance pula', () => {
    const waiting = start(definition);
    expect(waiting.waiting).toEqual({ kind: 'delay', nodeId: 'd', resumeAt: '2026-10-22T14:00:00.000Z' });
    expect(texts(waiting)[0]).toContain('2026-10-22T14:00:00.000Z');
    const resumed = stepSimulation(waiting, { kind: 'advance' }, clock);
    expect(texts(resumed)).toContain('Depois da espera');
    expect(resumed.completed).toBe(true);
  });

  it('reporta configuração inválida como erro do bloco', () => {
    const broken = flow('d', [node('d', 'delay', { mode: 'duration', duration: 0, unit: 'seconds' }), node('after', 'message', { text: 'x' })], [edge('e', 'd', 'after')]);
    expect(start(broken).error).toMatchObject({ code: 'INVALID_DELAY', nodeId: 'd' });
  });
});

describe('IA, Integração e Pixel', () => {
  const definition = flow('ai', [
    node('ai', 'ai', { responseVariable: 'ai.response' }),
    node('ok', 'webhook'),
    node('bad', 'message', { text: 'Deu erro' }),
    node('px', 'pixel'),
    node('done', 'message', { text: 'Fim: {{ai.response}}' })
  ], [
    edge('a1', 'ai', 'ok', { port: 'success' }),
    edge('a2', 'ai', 'bad', { port: 'failure' }),
    edge('w1', 'ok', 'px', { port: 'success' }),
    edge('p1', 'px', 'done', { port: 'success' })
  ]);

  it('mostra cartão simulado e a saída vem do input port', () => {
    const atAi = start(definition);
    expect(atAi.waiting).toEqual({ kind: 'port', nodeId: 'ai', ports: ['success', 'failure'] });
    expect(texts(atAi)[0]).toContain('IA simulado');

    const atWebhook = stepSimulation(atAi, { kind: 'port', nodeId: 'ai', port: 'success' }, clock);
    expect(atWebhook.waiting).toEqual({ kind: 'port', nodeId: 'ok', ports: ['success'] });
    expect(atWebhook.context).toMatchObject({ ai: { response: 'Resposta simulada da IA.' } });

    const atPixel = stepSimulation(atWebhook, { kind: 'port', nodeId: 'ok', port: 'success' }, clock);
    const done = stepSimulation(atPixel, { kind: 'port', nodeId: 'px', port: 'success' }, clock);
    expect(texts(done)).toContain('Fim: Resposta simulada da IA.');
    expect(done.completed).toBe(true);
  });

  it('a porta de falha segue o caminho de falha', () => {
    const failed = stepSimulation(start(definition), { kind: 'port', nodeId: 'ai', port: 'failure' }, clock);
    expect(texts(failed)).toContain('Deu erro');
  });

  it('ignora uma porta que não existe ou de outro nó', () => {
    const atAi = start(definition);
    expect(stepSimulation(atAi, { kind: 'port', nodeId: 'ai', port: 'timeout' }, clock)).toBe(atAi);
    expect(stepSimulation(atAi, { kind: 'port', nodeId: 'px', port: 'success' }, clock)).toBe(atAi);
  });
});

describe('manipulador', () => {
  it('muda só o contexto em memória, inclusive para campos do contato', () => {
    const definition = flow('m', [
      node('m', 'manipulator', { target: 'contact.customFields.pontos', operation: 'add', value: '5' }),
      node('f', 'manipulator', { target: 'flow.total', operation: 'multiply', value: '2' }),
      node('done', 'message', { text: 'pontos={{contact.customFields.pontos}} total={{total}}' })
    ], [
      edge('s1', 'm', 'f', { port: 'success' }),
      edge('s2', 'f', 'done', { port: 'success' })
    ]);
    const done = start(definition, { contact: { customFields: { pontos: 10 } }, total: 3 });
    expect(done.context).toMatchObject({ contact: { customFields: { pontos: 15 } }, total: 6 });
    expect(texts(done)).toContain('pontos=15 total=6');
  });

  it('usa a porta de falha e guarda o motivo', () => {
    const definition = flow('m', [
      node('m', 'manipulator', { target: 'flow.saldo', operation: 'divide', value: '0', failureVariable: 'manipulator.error' }),
      node('bad', 'message', { text: 'falhou: {{manipulator.error}}' })
    ], [edge('f', 'm', 'bad', { port: 'failure' })]);
    const failed = start(definition, { saldo: 10 });
    expect(texts(failed)).toContain('falhou: Divisão por zero.');
  });

  it('sem porta de falha o bloco quebra a simulação', () => {
    const definition = flow('m', [node('m', 'manipulator', { target: 'flow.saldo', operation: 'divide', value: '0' })], []);
    expect(start(definition, { saldo: 1 }).error).toMatchObject({ code: 'MANIPULATOR_FAILED', nodeId: 'm' });
  });
});

describe('término', () => {
  it('o controlador de chat encerra e explica o motivo', () => {
    const definition = flow('h', [node('h', 'handoff', { state: 'RESOLVED', queue: 'Vendas', reason: 'Pedido fechado' })], []);
    const ended = start(definition);
    expect(ended.completed).toBe(true);
    expect(ended.waiting).toBeNull();
    expect(ended.activeNodeId).toBe('h');
    expect(texts(ended).join(' ')).toContain('Conversa marcada como resolvida na fila Vendas. Motivo: Pedido fechado');
  });

  it('o controlador em Aguardando com volta para a automação continua', () => {
    const definition = flow('h', [
      node('h', 'handoff', { state: 'AWAITING', returnToAi: true, reason: 'Fila' }),
      node('next', 'message', { text: 'Seguimos' })
    ], [edge('e', 'h', 'next')]);
    const ended = start(definition);
    expect(texts(ended)).toContain('Seguimos');
    expect(ended.visitedNodeIds).toEqual(['h', 'next']);
  });

  it('o resultado encerra explicando o desfecho', () => {
    const definition = flow('o', [node('o', 'outcome', { type: 'SALE', valueCents: 25000 })], []);
    expect(texts(start(definition)).join(' ')).toContain('Resultado registrado na simulação: SALE (R$ 250)');
  });

  it('um bloco sem saída encerra explicando', () => {
    const definition = flow('msg', [node('msg', 'message', { text: 'Tchau' })], []);
    const ended = start(definition);
    expect(ended.completed).toBe(true);
    expect(texts(ended).join(' ')).toContain('O fluxo termina aqui');
  });
});

describe('salto de fluxo', () => {
  const target = flow('t2', [node('t2', 'message', { text: 'Fluxo B falando' })], []);
  const definition = flow('j', [node('j', 'flow_jump', { targetPlaybookId: 'pb_2', targetName: 'Fluxo B' })], []);

  it('continua na definição do destino carregada somente para leitura', () => {
    const loads: string[] = [];
    const jumped = stepSimulation(createSimulation(definition), { kind: 'start' }, {
      ...clock,
      loadFlow: id => { loads.push(id); return { definition: target, name: 'Fluxo B' }; }
    });
    expect(loads).toEqual(['pb_2']);
    expect(texts(jumped)).toContain('Fluxo B falando');
    expect(jumped.visitedNodeIds).toEqual(['j', 't2']);
  });

  it('sem destino disponível encerra explicando', () => {
    const ended = start(definition);
    expect(ended.completed).toBe(true);
    expect(texts(ended).join(' ')).toContain('Fluxo B');
  });
});

describe('limites', () => {
  it('para em 200 passos', () => {
    const definition = flow('a', [node('a', 'condition'), node('b', 'condition')], [
      edge('ab', 'a', 'b', { isDefault: true }),
      edge('ba', 'b', 'a', { isDefault: true })
    ]);
    const looped = start(definition);
    expect(looped.steps).toBe(SIMULATION_MAX_STEPS);
    expect(looped.error).toMatchObject({ code: 'MAX_STEPS_EXCEEDED' });
    expect(looped.messages).toHaveLength(0);
  });

  it('para em 100 mensagens', () => {
    const definition = flow('a', [node('a', 'message', { text: 'ping' }), node('b', 'message', { text: 'pong' })], [
      edge('ab', 'a', 'b'),
      edge('ba', 'b', 'a')
    ]);
    const looped = start(definition);
    expect(looped.messages).toHaveLength(SIMULATION_MAX_MESSAGES);
    expect(looped.error).toMatchObject({ code: 'MAX_MESSAGES_EXCEEDED' });
    expect(looped.steps).toBeLessThanOrEqual(SIMULATION_MAX_STEPS);
  });

  it('um estado encerrado ou com erro não avança mais', () => {
    const ended = start(flow('o', [node('o', 'outcome', { type: 'LOST' })], []));
    expect(stepSimulation(ended, { kind: 'advance' }, clock)).toBe(ended);
    expect(stepSimulation(ended, { kind: 'start' }, clock)).toBe(ended);
  });

  it('start duas vezes não reinicia o fluxo', () => {
    const started = start(flow('w', [node('w', 'wait_response', {})], []));
    expect(stepSimulation(started, { kind: 'start' }, clock)).toBe(started);
  });
});

describe('isolamento: nada é escrito em lugar nenhum', () => {
  const originals = { fetch: globalThis.fetch, now: Date.now };
  afterEach(() => {
    globalThis.fetch = originals.fetch;
    Date.now = originals.now;
    delete (globalThis as Record<string, unknown>).prisma;
    delete (globalThis as Record<string, unknown>).redis;
  });

  // Every member access or call on these throws, so any attempt to write (or to read the wall clock,
  // or to reach the network) fails the walk instead of passing silently.
  const trap = (name: string, attempts: string[]) => new Proxy(function () {} as unknown as Record<string, unknown>, {
    get: (_target, property) => { attempts.push(`${name}.${String(property)}`); throw new Error(`escrita proibida: ${name}.${String(property)}`); },
    apply: () => { attempts.push(`${name}()`); throw new Error(`escrita proibida: ${name}()`); },
    set: (_target, property) => { attempts.push(`${name}.${String(property)}=`); throw new Error(`escrita proibida: ${name}.${String(property)}=`); }
  });

  const funnel = flow('t', [
    node('t', 'trigger'),
    node('welcome', 'message', { items: [{ type: 'text', text: 'Bem-vindo, {{contact.name}}' }, { type: 'pause', minSeconds: 3, maxSeconds: 5 }, { type: 'image', url: 'https://cdn.example.com/a.png', caption: 'catálogo' }] }),
    node('menu', 'buttons', { text: 'O que você quer?', buttons: [{ id: 'buy', label: 'Comprar' }, { id: 'info', label: 'Dúvidas' }] }),
    node('ask', 'wait_response', { message: 'Qual seu nome?', saveReplyTo: 'nome', timeoutValue: 2, timeoutUnit: 'hours' }),
    node('score', 'manipulator', { target: 'contact.customFields.pontos', operation: 'add', value: '10' }),
    node('check', 'condition', { logic: 'all', rules: [{ field: 'contact.customFields.pontos', operator: 'greater_than', value: 5 }] }),
    node('crm', 'webhook', { url: 'https://crm.example.com/leads' }),
    node('ia', 'ai', { prompt: 'classifique' }),
    node('tracker', 'pixel', { eventName: 'Purchase', value: '10' }),
    node('tagit', 'tag', { tags: ['vip'] }),
    node('notify', 'notification', { phone: '+5571999999999', message: 'lead novo' }),
    node('wait', 'delay', { mode: 'duration', duration: 1, unit: 'minutes' }),
    node('sale', 'outcome', { type: 'SALE', valueCents: 10000 }),
    node('human', 'handoff', { state: 'ATTENDING', queue: 'Vendas', reason: 'Dúvida complexa' })
  ], [
    edge('e1', 't', 'welcome'),
    edge('e2', 'welcome', 'menu'),
    edge('e3', 'menu', 'ask', { condition: { field: 'menu.choice', operator: 'equals', value: 'buy' } }),
    edge('e4', 'menu', 'human', { condition: { field: 'menu.choice', operator: 'equals', value: 'info' } }),
    edge('e5', 'ask', 'score', { port: 'reply' }),
    edge('e6', 'ask', 'human', { port: 'timeout' }),
    edge('e7', 'score', 'check', { port: 'success' }),
    edge('e8', 'check', 'crm'),
    edge('e9', 'check', 'human', { isDefault: true, priority: 10 }),
    edge('e10', 'crm', 'ia', { port: 'success' }),
    edge('e11', 'crm', 'human', { port: 'failure' }),
    edge('e12', 'ia', 'tracker', { port: 'success' }),
    edge('e13', 'ia', 'human', { port: 'failure' }),
    edge('e14', 'tracker', 'tagit', { port: 'success' }),
    edge('e15', 'tracker', 'human', { port: 'failure' }),
    edge('e16', 'tagit', 'notify'),
    edge('e17', 'notify', 'wait'),
    edge('e18', 'wait', 'sale')
  ]);

  it('percorre o funil inteiro com adapters que explodem em qualquer escrita', () => {
    const attempts: string[] = [];
    globalThis.fetch = trap('fetch', attempts) as unknown as typeof fetch;
    (globalThis as Record<string, unknown>).prisma = trap('prisma', attempts);
    (globalThis as Record<string, unknown>).redis = trap('redis', attempts);
    Date.now = trap('Date.now', attempts) as unknown as typeof Date.now;

    const variables = Object.freeze({ contact: Object.freeze({ name: 'Ana', customFields: Object.freeze({ pontos: 1 }) }) });
    const definition = Object.freeze({ ...funnel, nodes: Object.freeze(funnel.nodes.map(item => Object.freeze(item))), edges: Object.freeze(funnel.edges.map(item => Object.freeze(item))) }) as SimulationDefinition;
    const before = JSON.stringify(definition);

    const loadFlow = () => { attempts.push('loadFlow'); return null; };
    let state = stepSimulation(createSimulation(definition, variables), { kind: 'start' }, { ...clock, loadFlow });
    const afterStart = JSON.stringify(state);
    state = stepSimulation(state, { kind: 'choice', optionId: 'buy' }, { ...clock, loadFlow });
    state = stepSimulation(state, { kind: 'reply', text: 'Ana' }, { ...clock, loadFlow });
    state = stepSimulation(state, { kind: 'port', nodeId: 'crm', port: 'success' }, { ...clock, loadFlow });
    state = stepSimulation(state, { kind: 'port', nodeId: 'ia', port: 'success' }, { ...clock, loadFlow });
    state = stepSimulation(state, { kind: 'port', nodeId: 'tracker', port: 'success' }, { ...clock, loadFlow });
    const atDelay = state;
    state = stepSimulation(state, { kind: 'advance' }, { ...clock, loadFlow });

    // The whole funnel ran: menu, wait, manipulator, condition, integration, AI, pixel, tag, notification, delay, outcome.
    expect(state.error).toBeUndefined();
    expect(state.completed).toBe(true);
    expect(state.visitedNodeIds).toEqual(['t', 'welcome', 'menu', 'ask', 'score', 'check', 'crm', 'ia', 'tracker', 'tagit', 'notify', 'wait', 'sale']);
    expect(state.context).toMatchObject({ contact: { customFields: { pontos: 11, nome: 'Ana' } } });
    expect(texts(state).join(' ')).toContain('Resultado registrado na simulação: SALE');

    // Nothing outside the engine was ever touched, and no step mutated its inputs.
    expect(attempts).toEqual([]);
    expect(JSON.stringify(definition)).toBe(before);
    expect(variables.contact.customFields).toEqual({ pontos: 1 });
    expect(JSON.stringify(atDelay)).not.toBe(JSON.stringify(state));
    expect(afterStart).toBe(JSON.stringify(stepSimulation(createSimulation(definition, variables), { kind: 'start' }, { ...clock, loadFlow })));
  });

  it('o código do motor não fala com banco, fila, rede nem com o relógio global', () => {
    const sources = ['simulation.ts', 'routing.ts', 'conditions.ts'].map(file => readFileSync(new URL(file, import.meta.url), 'utf8'));
    for (const source of sources) {
      for (const forbidden of [/prisma/i, /redis/i, /bullmq/i, /\bfetch\s*\(/, /XMLHttpRequest/, /process\.env/, /Date\.now/, /node:(fs|net|http)/, /@nexo\/contracts/, /@prisma/]) {
        expect(source).not.toMatch(forbidden);
      }
    }
    // The single `new Date()` is the default clock; everything else goes through `options.now`.
    expect(sources[0]!.match(/new Date\(/g)).toHaveLength(1);
  });
});
