// Pure flow simulator: walks a definition exactly as apps/runtime's engine does, with zero side effects.
// No database, no queue, no network, no wall clock except `options.now`. Edge selection, interpolation and context
// writes come from ./routing.js, the same module the real runtime re-exports, so the two cannot drift.
import { getPathValue } from './conditions.js';
import { nextDelayAt, normalizeDelayConfig } from './delay.js';
import { applyManipulation, parseTarget, type Operation } from './manipulator.js';
import { menuOptions, renderTemplate, resolveMenuChoice, routesByChoice, selectNextEdge, setContextPath, type FlowEdge, type FlowNode, type MenuOption } from './routing.js';

export const SIMULATION_MAX_STEPS = 200;
export const SIMULATION_MAX_MESSAGES = 100;

export type SimulationDefinition = { start: string; nodes: FlowNode[]; edges: FlowEdge[] };
export type SimulationPort = 'success' | 'failure' | 'reply' | 'timeout';

export type SimulationMessage = {
  id: string;
  role: 'bot' | 'contact' | 'system';
  nodeId: string | null;
  /** Card kind for the chat UI: a real outbound message, a simulated side effect, a delay, the end or a failure. */
  kind: 'text' | 'media' | 'menu' | 'simulated' | 'delay' | 'end' | 'error';
  text: string | null;
  mediaUrl?: string | null;
  options?: MenuOption[];
  detail?: string;
  at: string;
};

export type SimulationWait =
  | { kind: 'choice'; nodeId: string; options: MenuOption[]; canTimeout: boolean }
  | { kind: 'reply'; nodeId: string; canTimeout: boolean }
  | { kind: 'delay'; nodeId: string; resumeAt: string | null }
  | { kind: 'port'; nodeId: string; ports: SimulationPort[] };

export type SimulationInput =
  | { kind: 'start' }
  | { kind: 'reply'; text: string }
  | { kind: 'choice'; optionId: string }
  | { kind: 'advance' }
  | { kind: 'port'; nodeId: string; port: SimulationPort };

export type SimulationState = {
  definition: SimulationDefinition;
  context: Record<string, unknown>;
  messages: SimulationMessage[];
  activeNodeId: string | null;
  visitedNodeIds: string[];
  waiting: SimulationWait | null;
  completed: boolean;
  error?: { code: string; message: string; nodeId: string | null };
  steps: number;
};

export type SimulationOptions = {
  /** The only source of time. Defaults to the system clock so callers that do not care stay simple. */
  now?: () => Date;
  timezone?: string;
  /** Read-only lookup of a flow jump target's active definition. The engine never writes through it. */
  loadFlow?: (targetPlaybookId: string) => { definition: SimulationDefinition; name?: string } | null;
  /** Response the AI block reports on a simulated success. */
  aiResponse?: string;
};

type Resolved = { now: () => Date; timezone: string; loadFlow?: SimulationOptions['loadFlow']; aiResponse: string };

const resolve = (options: SimulationOptions = {}): Resolved => ({
  now: options.now ?? (() => new Date()),
  timezone: options.timezone ?? 'America/Bahia',
  ...(options.loadFlow ? { loadFlow: options.loadFlow } : {}),
  aiResponse: options.aiResponse ?? 'Resposta simulada da IA.'
});

const text = (node: FlowNode, key: string, context: Record<string, unknown>): string =>
  typeof node.config?.[key] === 'string' ? renderTemplate(node.config[key] as string, context) : '';

const config = (node: FlowNode): Record<string, unknown> => node.config ?? {};
const edgePort = (edge: FlowEdge): SimulationPort => (edge.port ?? 'success') as SimulationPort;
const portEdge = (state: SimulationState, nodeId: string, port: SimulationPort) =>
  state.definition.edges.find(edge => edge.source === nodeId && edgePort(edge) === port);
const wiredPorts = (state: SimulationState, nodeId: string, ports: SimulationPort[]) =>
  ports.filter(port => portEdge(state, nodeId, port));

export function createSimulation(definition: SimulationDefinition, variables: Record<string, unknown> = {}): SimulationState {
  return {
    definition,
    context: structuredClone(variables),
    messages: [],
    activeNodeId: null,
    visitedNodeIds: [],
    waiting: null,
    completed: false,
    steps: 0
  };
}

/**
 * Applies one input and runs until the flow waits again, ends or fails. Never mutates `state`.
 * An input that does not match the current wait is a no-op: a stray click never breaks a session.
 */
export function stepSimulation(state: SimulationState, input: SimulationInput, options: SimulationOptions = {}): SimulationState {
  if (state.completed || state.error) return state;
  const o = resolve(options);
  const next: SimulationState = { ...state, context: structuredClone(state.context), messages: [...state.messages], visitedNodeIds: [...state.visitedNodeIds] };
  if (!accept(next, input, o)) return state;
  run(next, o);
  return next;
}

function accept(s: SimulationState, input: SimulationInput, o: Resolved): boolean {
  const waiting = s.waiting;
  if (input.kind === 'start') {
    if (s.steps > 0 || waiting) return false;
    s.activeNodeId = s.definition.start;
    return true;
  }
  if (!waiting) return false;
  const node = s.definition.nodes.find(item => item.id === waiting.nodeId);
  if (!node) {
    fail(s, 'NODE_NOT_FOUND', `Nó ${waiting.nodeId} não encontrado.`);
    return true;
  }
  if (input.kind === 'reply' && waiting.kind === 'choice') {
    const option = resolveMenuChoice(waiting.options, { text: input.text });
    say(s, { role: 'contact', nodeId: node.id, kind: 'text', text: input.text }, o);
    // Like the real runtime: an answer that matches no option leaves the menu waiting.
    if (!option) return true;
    return takeChoice(s, node, option, o);
  }
  if (input.kind === 'choice' && waiting.kind === 'choice') {
    const option = resolveMenuChoice(waiting.options, { id: input.optionId });
    if (!option) return false;
    say(s, { role: 'contact', nodeId: node.id, kind: 'text', text: option.label }, o);
    return takeChoice(s, node, option, o);
  }
  if (input.kind === 'reply' && waiting.kind === 'reply') {
    say(s, { role: 'contact', nodeId: node.id, kind: 'text', text: input.text }, o);
    s.context = setContextPath(setContextPath(s.context, 'last_message', input.text), 'last_message_type', 'TEXT');
    const saveReplyTo = typeof config(node).saveReplyTo === 'string' ? (config(node).saveReplyTo as string).trim() : '';
    // In simulation the reply is only remembered in the context; the contact record is never touched.
    if (saveReplyTo && (config(node).saveEmpty !== false || input.text.length > 0)) s.context = setContextPath(s.context, `contact.customFields.${saveReplyTo}`, input.text);
    s.waiting = null;
    route(s, node, portEdge(s, node.id, 'reply')?.target, 'O bloco Aguarda Resposta não tem saída para a resposta.', o);
    return true;
  }
  if (input.kind === 'advance') return advance(s, node, waiting, o);
  if (input.kind === 'port' && waiting.kind === 'port' && input.nodeId === node.id && waiting.ports.includes(input.port)) {
    s.waiting = null;
    if (node.kind === 'ai') {
      const variable = typeof config(node).responseVariable === 'string' && config(node).responseVariable ? config(node).responseVariable as string : 'ai.response';
      const failVariable = typeof config(node).failReasonVariable === 'string' && config(node).failReasonVariable ? config(node).failReasonVariable as string : 'ai.fail.reason';
      s.context = input.port === 'success' ? setContextPath(s.context, variable, o.aiResponse) : setContextPath(s.context, failVariable, 'Falha simulada.');
    }
    say(s, { role: 'system', nodeId: node.id, kind: 'simulated', text: `Saída simulada: ${input.port === 'success' ? 'sucesso' : 'falha'}.` }, o);
    route(s, node, portEdge(s, node.id, input.port)?.target, `A saída ${input.port} de ${node.name ?? node.id} não está conectada.`, o);
    return true;
  }
  return false;
}

function advance(s: SimulationState, node: FlowNode, waiting: SimulationWait, o: Resolved): boolean {
  if (waiting.kind === 'delay') {
    s.waiting = null;
    say(s, { role: 'system', nodeId: node.id, kind: 'delay', text: 'Espera pulada na simulação.' }, o);
    route(s, node, selectNextEdge(node, s.definition.edges, s.context)?.target, 'O bloco de espera não tem saída conectada.', o);
    return true;
  }
  if (waiting.kind === 'reply' && waiting.canTimeout) {
    s.waiting = null;
    say(s, { role: 'system', nodeId: node.id, kind: 'simulated', text: 'Sem resposta: seguindo pela saída de tempo esgotado.' }, o);
    route(s, node, portEdge(s, node.id, 'timeout')?.target, 'O bloco Aguarda Resposta não tem saída para quem não respondeu.', o);
    return true;
  }
  if (waiting.kind === 'choice' && waiting.canTimeout) {
    s.waiting = null;
    s.context = setContextPath(s.context, 'menu', { timedOut: true });
    say(s, { role: 'system', nodeId: node.id, kind: 'simulated', text: 'Menu sem escolha: seguindo pela saída de inatividade.' }, o);
    route(s, node, selectNextEdge(node, s.definition.edges, s.context)?.target, 'O menu não tem saída para inatividade.', o);
    return true;
  }
  return false;
}

function takeChoice(s: SimulationState, node: FlowNode, option: MenuOption, o: Resolved): boolean {
  s.waiting = null;
  s.context = setContextPath(s.context, 'menu', { choice: option.id, label: option.label, timedOut: false });
  const saveAs = typeof config(node).saveAs === 'string' ? (config(node).saveAs as string).trim() : '';
  if (saveAs) s.context = setContextPath(s.context, saveAs, option.label);
  route(s, node, selectNextEdge(node, s.definition.edges, s.context)?.target, `A opção "${option.label}" não tem saída conectada.`, o);
  return true;
}

function run(s: SimulationState, o: Resolved) {
  while (s.activeNodeId && !s.waiting && !s.completed && !s.error) {
    if (s.steps >= SIMULATION_MAX_STEPS) {
      fail(s, 'MAX_STEPS_EXCEEDED', `A simulação excedeu ${SIMULATION_MAX_STEPS} passos.`);
      return;
    }
    const node = s.definition.nodes.find(item => item.id === s.activeNodeId);
    if (!node) {
      fail(s, 'NODE_NOT_FOUND', `Nó ${s.activeNodeId} não encontrado.`);
      return;
    }
    if (!s.visitedNodeIds.includes(node.id)) s.visitedNodeIds.push(node.id);
    s.steps += 1;
    runNode(s, node, o);
  }
}

function runNode(s: SimulationState, node: FlowNode, o: Resolved) {
  const nextOf = () => selectNextEdge(node, s.definition.edges, s.context)?.target;
  switch (node.kind) {
    case 'trigger':
      return route(s, node, nextOf(), 'O gatilho não tem saída conectada.', o);

    case 'condition':
      return route(s, node, nextOf(), 'A condição não tem saída para este caminho.', o);

    case 'message': {
      for (const item of messageItems(node)) {
        if (s.error) return;
        if (item.type === 'pause') continue; // Pauses keep their place in the order but never wait in simulation.
        say(s, { role: 'bot', nodeId: node.id, kind: item.mediaUrl ? 'media' : 'text', text: item.text, mediaUrl: item.mediaUrl }, o);
      }
      return route(s, node, nextOf(), 'A mensagem não tem saída conectada.', o);
    }

    case 'image':
    case 'audio':
    case 'sticker': {
      say(s, { role: 'bot', nodeId: node.id, kind: 'media', text: text(node, 'caption', s.context) || null, mediaUrl: text(node, 'url', s.context) || null }, o);
      return route(s, node, nextOf(), 'O bloco de mídia não tem saída conectada.', o);
    }

    case 'buttons': {
      const options = menuOptions(node);
      say(s, { role: 'bot', nodeId: node.id, kind: 'menu', text: text(node, 'text', s.context) || null, options }, o);
      if (s.error) return;
      if (!routesByChoice(node, s.definition.edges)) return route(s, node, nextOf(), 'O menu não tem saída conectada.', o);
      s.activeNodeId = node.id;
      s.waiting = { kind: 'choice', nodeId: node.id, options, canTimeout: true };
      return;
    }

    case 'wait_response': {
      const question = text(node, 'message', s.context).trim();
      if (question) say(s, { role: 'bot', nodeId: node.id, kind: 'text', text: question }, o);
      if (s.error) return;
      s.activeNodeId = node.id;
      s.waiting = { kind: 'reply', nodeId: node.id, canTimeout: config(node).waitIndefinitely !== true && Boolean(portEdge(s, node.id, 'timeout')) };
      return;
    }

    case 'delay': {
      let resumeAt: string | null = null;
      let detail = 'Espera simulada.';
      try {
        const plan = nextDelayAt(normalizeDelayConfig(config(node)), o.now(), o.timezone);
        resumeAt = plan.at.toISOString();
        detail = `Espera ${plan.mode === 'duration' ? 'por tempo' : plan.mode === 'date' ? 'até a data' : 'até o horário permitido'}: ${resumeAt}.`;
      } catch (error) {
        return fail(s, 'INVALID_DELAY', error instanceof Error ? error.message : 'Intervalo inválido.', node.id);
      }
      if (!nextOf()) return end(s, node, 'A espera não tem saída conectada: o fluxo termina aqui.', o);
      say(s, { role: 'system', nodeId: node.id, kind: 'delay', text: detail, detail: resumeAt ?? undefined }, o);
      if (s.error) return;
      s.activeNodeId = node.id;
      s.waiting = { kind: 'delay', nodeId: node.id, resumeAt };
      return;
    }

    case 'ai':
    case 'webhook':
    case 'pixel': {
      const label = node.kind === 'ai' ? 'IA' : node.kind === 'webhook' ? 'Integração' : 'Pixel';
      const ports = wiredPorts(s, node.id, ['success', 'failure']);
      say(s, { role: 'system', nodeId: node.id, kind: 'simulated', text: `${label} simulado: nada foi chamado de verdade.`, detail: node.name }, o);
      if (s.error) return;
      if (!ports.length) return end(s, node, `${label} não tem saídas conectadas: o fluxo termina aqui.`, o);
      s.activeNodeId = node.id;
      s.waiting = { kind: 'port', nodeId: node.id, ports };
      return;
    }

    case 'manipulator': {
      const target = typeof config(node).target === 'string' ? parseTarget(config(node).target as string) : null;
      const operation = config(node).operation as Operation | undefined;
      if (!target || !operation) return fail(s, 'INVALID_MANIPULATOR_CONFIG', 'Configure o destino, a operação e o valor do Manipulador.', node.id);
      const path = target.scope === 'flow' ? target.path : `contact.customFields.${target.path}`;
      const result = applyManipulation(getPathValue(s.context, path), operation, text(node, 'value', s.context));
      const failVariable = typeof config(node).failureVariable === 'string' ? config(node).failureVariable as string : 'manipulator.error';
      if (!result.ok) {
        s.context = setContextPath(s.context, failVariable, result.reason);
        say(s, { role: 'system', nodeId: node.id, kind: 'simulated', text: `Manipulador falhou: ${result.reason}`, detail: config(node).target as string }, o);
        if (s.error) return;
        const failure = portEdge(s, node.id, 'failure');
        if (!failure) return fail(s, 'MANIPULATOR_FAILED', result.reason, node.id);
        s.activeNodeId = failure.target;
        return;
      }
      // Simulation only ever changes the in-memory context, even for `contact.customFields.*`.
      s.context = setContextPath(s.context, path, result.value);
      say(s, { role: 'system', nodeId: node.id, kind: 'simulated', text: `Manipulador: ${config(node).target} = ${JSON.stringify(result.value)} (só na simulação).` }, o);
      if (s.error) return;
      return route(s, node, portEdge(s, node.id, 'success')?.target, 'O Manipulador não tem saída de sucesso conectada.', o);
    }

    case 'handoff': {
      const state = typeof config(node).state === 'string' ? config(node).state as string : 'ATTENDING';
      const queue = typeof config(node).queue === 'string' ? config(node).queue as string : typeof config(node).team === 'string' ? config(node).team as string : undefined;
      const reason = text(node, 'reason', s.context) || 'Handoff solicitado pela automação.';
      const label = state === 'RESOLVED' ? 'Conversa marcada como resolvida' : state === 'AWAITING' ? 'Conversa devolvida para a fila (aguardando)' : 'Conversa entregue para atendimento humano';
      const explanation = `${label}${queue ? ` na fila ${queue}` : ''}. Motivo: ${reason}`;
      const continues = config(node).returnToAi === true && state === 'AWAITING' && Boolean(nextOf());
      if (continues) {
        say(s, { role: 'system', nodeId: node.id, kind: 'simulated', text: `${explanation} A automação continua.` }, o);
        if (s.error) return;
        return route(s, node, nextOf(), 'O Controlador de Chat não tem saída conectada.', o);
      }
      return end(s, node, `${explanation} O fluxo termina aqui.`, o);
    }

    case 'outcome': {
      const type = typeof config(node).type === 'string' ? config(node).type as string : 'desfecho';
      const value = typeof config(node).valueCents === 'number' ? ` (R$ ${(config(node).valueCents as number) / 100})` : '';
      return end(s, node, `Resultado registrado na simulação: ${type}${value}. O fluxo termina aqui.`, o);
    }

    case 'flow_jump': {
      const targetId = typeof config(node).targetPlaybookId === 'string' ? config(node).targetPlaybookId as string : '';
      const loaded = targetId && o.loadFlow ? o.loadFlow(targetId) : null;
      if (!loaded) return end(s, node, `Salto de fluxo para ${config(node).targetName ?? targetId ?? 'outro fluxo'} não simulado: o fluxo de destino não está disponível aqui.`, o);
      say(s, { role: 'system', nodeId: node.id, kind: 'simulated', text: `Salto para o fluxo ${loaded.name ?? targetId}.` }, o);
      if (s.error) return;
      s.definition = loaded.definition;
      s.activeNodeId = loaded.definition.start;
      return;
    }

    case 'distributor': {
      // Simulation has no counters or past assignments: it always takes the first wired output.
      const edge = s.definition.edges.find(item => item.source === node.id);
      say(s, { role: 'system', nodeId: node.id, kind: 'simulated', text: `Distribuidor simulado: saída ${edge?.label ?? edge?.condition?.value ?? edge?.target ?? 'nenhuma'}.` }, o);
      if (s.error) return;
      return route(s, node, edge?.target, 'O distribuidor não tem saídas conectadas.', o);
    }

    default: {
      // assign, tag, kanban, notification, agent and anything added later: a simulated card, nothing written.
      say(s, { role: 'system', nodeId: node.id, kind: 'simulated', text: `${node.name ?? node.kind} simulado: nenhuma ação real foi executada.`, detail: node.kind }, o);
      if (s.error) return;
      return route(s, node, nextOf(), `${node.name ?? node.kind} não tem saída conectada.`, o);
    }
  }
}

type MessageItem = { type: string; text: string | null; mediaUrl: string | null };

// Reads what the message block renders, forgivingly: the definition is validated before a session starts.
function messageItems(node: FlowNode): MessageItem[] {
  const raw = Array.isArray(config(node).items) ? config(node).items as unknown[] : null;
  // Legacy single-text blocks.
  if (!raw) return typeof config(node).text === 'string' && (config(node).text as string).trim() ? [{ type: 'text', text: config(node).text as string, mediaUrl: null }] : [];
  return raw.flatMap(entry => {
    const item = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
    const type = typeof item.type === 'string' ? item.type : 'text';
    if (type === 'pause') return [{ type, text: null, mediaUrl: null }];
    if (type === 'text') return [{ type, text: typeof item.text === 'string' ? item.text : '', mediaUrl: null }];
    if (type === 'contact') return [{ type, text: typeof item.name === 'string' ? item.name : 'contato', mediaUrl: null }];
    const caption = typeof item.caption === 'string' ? item.caption : typeof item.fileName === 'string' ? item.fileName : null;
    return [{ type, text: caption, mediaUrl: typeof item.url === 'string' ? item.url : null }];
  });
}

function say(s: SimulationState, message: Omit<SimulationMessage, 'id' | 'at'>, o: Resolved) {
  if (s.messages.length >= SIMULATION_MAX_MESSAGES) {
    fail(s, 'MAX_MESSAGES_EXCEEDED', `A simulação excedeu ${SIMULATION_MAX_MESSAGES} mensagens.`, message.nodeId ?? undefined);
    return;
  }
  const rendered = message.role === 'bot' && message.text ? renderTemplate(message.text, s.context) : message.text;
  s.messages.push({ ...message, text: rendered ?? null, id: `m${s.messages.length + 1}`, at: o.now().toISOString() });
}

function route(s: SimulationState, node: FlowNode, nextNodeId: string | undefined, endReason: string, o: Resolved) {
  if (nextNodeId) {
    s.activeNodeId = nextNodeId;
    return;
  }
  // A block with no exit ends the journey, as in the real engine.
  end(s, node, `${endReason} O fluxo termina aqui.`, o);
}

function end(s: SimulationState, node: FlowNode, reason: string, o: Resolved) {
  say(s, { role: 'system', nodeId: node.id, kind: 'end', text: reason }, o);
  s.activeNodeId = node.id;
  s.waiting = null;
  s.completed = true;
}

function fail(s: SimulationState, code: string, message: string, nodeId?: string) {
  s.error = { code, message, nodeId: nodeId ?? s.activeNodeId ?? null };
  s.waiting = null;
}
