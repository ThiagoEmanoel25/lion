import { AutomationDefinitionSchema } from '@nexo/contracts';
import type { z } from 'zod';

export type AutomationDefinition = z.infer<typeof AutomationDefinitionSchema>;
type AutomationEdge = AutomationDefinition['edges'][number];
export type AutomationIssue = { level: 'error' | 'warning'; code: string; message: string; nodeId?: string; edgeId?: string };
export type SimulationStep = { index: number; nodeId: string; kind: AutomationDefinition['nodes'][number]['kind']; selectedEdgeId: string | null };

const terminalKinds = new Set(['handoff', 'outcome']);
const outcomeKinds = new Set(['QUALIFIED', 'APPOINTMENT', 'SALE', 'RESOLVED', 'HANDOFF', 'DISQUALIFIED']);

function nodeConfigIssues(node: AutomationDefinition['nodes'][number]): AutomationIssue[] {
  const config = node.config;
  const error = (code: string, message: string): AutomationIssue => ({ level: 'error', code, message, nodeId: node.id });
  switch (node.kind) {
    case 'message':
      return typeof config.text === 'string' && config.text.trim() ? [] : [error('MESSAGE_TEXT_REQUIRED', 'O nó de mensagem precisa de um texto.')];
    case 'delay':
      return typeof config.seconds === 'number' && Number.isInteger(config.seconds) && config.seconds >= 1 && config.seconds <= 2_592_000 ? [] : [error('INVALID_DELAY', 'A espera deve ter entre 1 segundo e 30 dias.')];
    case 'agent':
      return typeof config.prompt === 'string' && config.prompt.trim() ? [] : [error('AGENT_PROMPT_REQUIRED', 'O agente precisa de instruções.')];
    case 'webhook': {
      if (typeof config.url !== 'string') return [error('WEBHOOK_URL_REQUIRED', 'O webhook precisa de uma URL HTTPS.')];
      try {
        const url = new URL(config.url);
        return url.protocol === 'https:' ? [] : [error('WEBHOOK_HTTPS_REQUIRED', 'O webhook deve usar HTTPS.')];
      } catch {
        return [error('INVALID_WEBHOOK_URL', 'A URL do webhook é inválida.')];
      }
    }
    case 'assign':
      return typeof config.queue === 'string' && config.queue.trim() || typeof config.assigneeId === 'string' && config.assigneeId.trim() ? [] : [error('ASSIGN_TARGET_REQUIRED', 'Informe uma fila ou responsável para atribuição.')];
    case 'tag':
      return typeof config.tagId === 'string' && config.tagId.trim() || typeof config.tag === 'string' && config.tag.trim() ? [] : [error('TAG_REQUIRED', 'Informe a etiqueta que será aplicada.')];
    case 'outcome':
      return typeof config.type === 'string' && outcomeKinds.has(config.type) ? [] : [error('OUTCOME_TYPE_REQUIRED', 'Informe um tipo de desfecho válido.')];
    default:
      return [];
  }
}

export function validateAutomation(value: unknown) {
  const parsed = AutomationDefinitionSchema.safeParse(value);
  if (!parsed.success) {
    return { valid: false as const, issues: parsed.error.issues.map(issue => ({ level: 'error' as const, code: 'INVALID_SCHEMA', message: `${issue.path.join('.') || 'definition'}: ${issue.message}` })) };
  }
  const definition = parsed.data;
  const issues: AutomationIssue[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  for (const node of definition.nodes) {
    if (nodeIds.has(node.id)) issues.push({ level: 'error', code: 'DUPLICATE_NODE_ID', message: `O id de nó “${node.id}” está duplicado.`, nodeId: node.id });
    nodeIds.add(node.id);
    issues.push(...nodeConfigIssues(node));
  }

  const nodes = new Map(definition.nodes.map(node => [node.id, node]));
  if (!nodes.has(definition.start)) issues.push({ level: 'error', code: 'START_NOT_FOUND', message: 'O nó inicial não existe.' });
  else if (nodes.get(definition.start)?.kind !== 'trigger') issues.push({ level: 'error', code: 'START_MUST_BE_TRIGGER', message: 'O nó inicial precisa ser um gatilho.', nodeId: definition.start });

  const outgoing = new Map<string, typeof definition.edges>();
  const incoming = new Map<string, number>();
  const connectionKeys = new Set<string>();
  for (const edge of definition.edges) {
    if (edgeIds.has(edge.id)) issues.push({ level: 'error', code: 'DUPLICATE_EDGE_ID', message: `O id de conexão “${edge.id}” está duplicado.`, edgeId: edge.id });
    edgeIds.add(edge.id);
    if (!nodes.has(edge.source)) issues.push({ level: 'error', code: 'EDGE_SOURCE_NOT_FOUND', message: 'A origem da conexão não existe.', edgeId: edge.id });
    if (!nodes.has(edge.target)) issues.push({ level: 'error', code: 'EDGE_TARGET_NOT_FOUND', message: 'O destino da conexão não existe.', edgeId: edge.id });
    if (edge.source === edge.target) issues.push({ level: 'error', code: 'SELF_LOOP', message: 'Um nó não pode apontar diretamente para si mesmo.', edgeId: edge.id, nodeId: edge.source });
    const key = `${edge.source}:${edge.target}:${edge.label ?? ''}`;
    if (connectionKeys.has(key)) issues.push({ level: 'error', code: 'DUPLICATE_CONNECTION', message: 'Esta conexão já existe.', edgeId: edge.id });
    connectionKeys.add(key);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }

  for (const node of definition.nodes) {
    const edges = outgoing.get(node.id) ?? [];
    if (terminalKinds.has(node.kind) && edges.length) issues.push({ level: 'error', code: 'TERMINAL_HAS_OUTPUT', message: 'Nós finais não podem ter conexões de saída.', nodeId: node.id });
    if (!terminalKinds.has(node.kind) && edges.length === 0) issues.push({ level: 'error', code: 'MISSING_OUTPUT', message: 'O nó precisa de uma conexão de saída.', nodeId: node.id });
    if (node.kind !== 'condition' && edges.length > 1) issues.push({ level: 'error', code: 'AMBIGUOUS_OUTPUT', message: 'Somente condições podem ter mais de uma saída.', nodeId: node.id });
    if (node.kind === 'condition') {
      if (edges.length < 2) issues.push({ level: 'error', code: 'CONDITION_BRANCHES_REQUIRED', message: 'A condição precisa de ao menos duas saídas.', nodeId: node.id });
      if (edges.filter(edge => edge.isDefault).length !== 1) issues.push({ level: 'error', code: 'CONDITION_DEFAULT_REQUIRED', message: 'A condição precisa de exatamente uma saída padrão.', nodeId: node.id });
      const conditional = edges.filter(edge => !edge.isDefault);
      if (conditional.some(edge => !edge.condition)) issues.push({ level: 'error', code: 'BRANCH_CONDITION_REQUIRED', message: 'Toda saída não padrão precisa de uma condição.', nodeId: node.id });
      const priorities = new Set<number>();
      for (const edge of conditional) {
        if (priorities.has(edge.priority)) issues.push({ level: 'error', code: 'DUPLICATE_BRANCH_PRIORITY', message: 'As prioridades das condições devem ser únicas.', nodeId: node.id, edgeId: edge.id });
        priorities.add(edge.priority);
      }
    }
    if (node.id !== definition.start && (incoming.get(node.id) ?? 0) === 0) issues.push({ level: 'warning', code: 'NO_INCOMING_EDGE', message: 'O nó não possui uma conexão de entrada.', nodeId: node.id });
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const cyclicNodes = new Set<string>();
  function walk(id: string) {
    if (visiting.has(id)) { cyclicNodes.add(id); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of outgoing.get(id) ?? []) walk(edge.target);
    visiting.delete(id);
    visited.add(id);
  }
  if (nodes.has(definition.start)) walk(definition.start);
  for (const node of definition.nodes) if (!visited.has(node.id)) issues.push({ level: 'warning', code: 'UNREACHABLE_NODE', message: `O nó “${node.name}” nunca será executado.`, nodeId: node.id });
  for (const nodeId of cyclicNodes) issues.push({ level: 'warning', code: 'CYCLE_DETECTED', message: 'A jornada contém um ciclo e será limitada por maxSteps.', nodeId });
  if (!definition.nodes.some(node => terminalKinds.has(node.kind))) issues.push({ level: 'error', code: 'NO_TERMINAL_NODE', message: 'Adicione um desfecho ou handoff para encerrar a jornada.' });
  return { valid: !issues.some(issue => issue.level === 'error'), issues, definition };
}

function getPathValue(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined, source);
}

function matches(value: unknown, operator: NonNullable<AutomationDefinition['edges'][number]['condition']>['operator'], expected: unknown) {
  switch (operator) {
    case 'equals': return value === expected;
    case 'not_equals': return value !== expected;
    case 'contains': return Array.isArray(value) ? value.includes(expected) : typeof value === 'string' && value.includes(String(expected));
    case 'not_contains': return Array.isArray(value) ? !value.includes(expected) : typeof value !== 'string' || !value.includes(String(expected));
    case 'exists': return value !== undefined && value !== null;
    case 'not_exists': return value === undefined || value === null;
    case 'greater_than': return typeof value === 'number' && typeof expected === 'number' && value > expected;
    case 'less_than': return typeof value === 'number' && typeof expected === 'number' && value < expected;
  }
}

export function simulateAutomation(definition: AutomationDefinition, variables: Record<string, unknown> = {}) {
  const nodes = new Map(definition.nodes.map(node => [node.id, node]));
  const outgoing = new Map<string, typeof definition.edges>();
  for (const edge of definition.edges) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  const steps: SimulationStep[] = [];
  let current: string | undefined = definition.start;
  let stoppedBecause: 'completed' | 'max_steps' | 'dead_end' = 'completed';
  while (current && steps.length < definition.settings.maxSteps) {
    const node = nodes.get(current);
    if (!node) { stoppedBecause = 'dead_end'; break; }
    const candidates: AutomationEdge[] = [...(outgoing.get(current) ?? [])].sort((a, b) => a.priority - b.priority);
    let selected: AutomationEdge | undefined = candidates[0];
    if (node.kind === 'condition') selected = candidates.find(edge => edge.condition && matches(getPathValue(variables, edge.condition.field), edge.condition.operator, edge.condition.value)) ?? candidates.find(edge => edge.isDefault);
    steps.push({ index: steps.length, nodeId: current, kind: node.kind, selectedEdgeId: selected?.id ?? null });
    if (terminalKinds.has(node.kind)) { current = undefined; break; }
    if (!selected) { stoppedBecause = 'dead_end'; current = undefined; break; }
    current = selected.target;
  }
  if (current && steps.length >= definition.settings.maxSteps) stoppedBecause = 'max_steps';
  return { steps, path: steps.map(step => step.nodeId), stoppedBecause };
}
