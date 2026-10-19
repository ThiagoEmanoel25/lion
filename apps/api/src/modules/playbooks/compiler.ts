import {
  AI_ROUTE_FIELD,
  AutomationAiConfigSchema,
  AutomationAudioConfigSchema,
  AutomationButtonsConfigSchema,
  AutomationConditionConfigSchema,
  AutomationDelayConfigSchema,
  AutomationDefinitionSchema,
  AutomationDistributorConfigSchema,
  AutomationFlowJumpConfigSchema,
  AutomationImageConfigSchema,
  AutomationKanbanConfigSchema,
  AutomationPixelConfigSchema,
  AutomationMessageConfigSchema,
  AutomationNotificationConfigSchema,
  AutomationStickerConfigSchema,
  AutomationTagConfigSchema,
  AutomationTriggerConfigSchema,
  AutomationWaitResponseConfigSchema,
  AutomationWebhookConfigSchema,
  conditionMatches,
  DISTRIBUTOR_ROUTE_FIELD,
  edgePort,
  getPathValue,
  MENU_CHOICE_FIELD,
  nodePorts
} from '@nexo/contracts';
import type { z, ZodTypeAny } from 'zod';

export type AutomationDefinition = z.infer<typeof AutomationDefinitionSchema>;
type AutomationEdge = AutomationDefinition['edges'][number];
export type AutomationIssue = { level: 'error' | 'warning'; code: string; message: string; nodeId?: string; edgeId?: string };
export type SimulationStep = { index: number; nodeId: string; kind: AutomationDefinition['nodes'][number]['kind']; selectedEdgeId: string | null };

const terminalKinds = new Set(['handoff', 'outcome', 'flow_jump']);
const outcomeKinds = new Set(['QUALIFIED', 'APPOINTMENT', 'SALE', 'RESOLVED', 'HANDOFF', 'DISQUALIFIED']);

function nodeConfigIssues(node: AutomationDefinition['nodes'][number]): AutomationIssue[] {
  const config = node.config;
  const error = (code: string, message: string): AutomationIssue => ({ level: 'error', code, message, nodeId: node.id });
  const validateConfig = (schema: ZodTypeAny, code: string, label: string): AutomationIssue[] => {
    const parsed = schema.safeParse(config);
    if (parsed.success) return [];
    return parsed.error.issues.map(issue => error(code, `${label}: ${issue.path.join('.') || 'configuração'} — ${issue.message}`));
  };
  switch (node.kind) {
    case 'trigger':
      return validateConfig(AutomationTriggerConfigSchema, 'INVALID_TRIGGER_CONFIG', 'Gatilho inválido');
    case 'message':
      return validateConfig(AutomationMessageConfigSchema, 'MESSAGE_TEXT_REQUIRED', 'Mensagem inválida');
    case 'image':
      return validateConfig(AutomationImageConfigSchema, 'INVALID_IMAGE_CONFIG', 'Imagem inválida');
    case 'audio':
      return validateConfig(AutomationAudioConfigSchema, 'INVALID_AUDIO_CONFIG', 'Áudio inválido');
    case 'sticker':
      return validateConfig(AutomationStickerConfigSchema, 'INVALID_STICKER_CONFIG', 'Figurinha inválida');
    case 'buttons':
      return validateConfig(AutomationButtonsConfigSchema, 'INVALID_BUTTONS_CONFIG', 'Botões inválidos');
    case 'condition':
      return Array.isArray(config.rules) ? validateConfig(AutomationConditionConfigSchema, 'INVALID_CONDITION_CONFIG', 'Condicional inválida') : [];
    case 'delay':
      return validateConfig(AutomationDelayConfigSchema, 'INVALID_DELAY', 'Intervalo inteligente inválido');
    case 'agent':
      return typeof config.agentId === 'string' && config.agentId.trim() ? [] : [error('AGENT_REQUIRED', 'Selecione um agente de IA configurado.')];
    case 'webhook': {
      return validateConfig(AutomationWebhookConfigSchema, 'INVALID_WEBHOOK_CONFIG', 'Integração inválida');
    }
    case 'assign':
      return typeof config.queue === 'string' && config.queue.trim() || typeof config.assigneeId === 'string' && config.assigneeId.trim() ? [] : [error('ASSIGN_TARGET_REQUIRED', 'Informe uma fila ou responsável para atribuição.')];
    case 'tag':
      return validateConfig(AutomationTagConfigSchema, 'TAG_REQUIRED', 'Etiquetas inválidas');
    case 'outcome':
      return typeof config.type === 'string' && outcomeKinds.has(config.type) ? [] : [error('OUTCOME_TYPE_REQUIRED', 'Informe um tipo de desfecho válido.')];
    case 'ai':
      return validateConfig(AutomationAiConfigSchema, 'INVALID_AI_CONFIG', 'Bloco de IA inválido');
    case 'wait_response':
      return validateConfig(AutomationWaitResponseConfigSchema, 'INVALID_WAIT_RESPONSE_CONFIG', 'Aguarda Resposta inválido');
    case 'kanban':
      return validateConfig(AutomationKanbanConfigSchema, 'INVALID_KANBAN_CONFIG', 'Kanban inválido');
    case 'pixel':
      return validateConfig(AutomationPixelConfigSchema, 'INVALID_PIXEL_CONFIG', 'Pixel inválido');
    case 'flow_jump': {
      const base=validateConfig(AutomationFlowJumpConfigSchema,'INVALID_FLOW_JUMP_CONFIG','Salto de fluxo inválido');
      return typeof config.targetPlaybookId==='string'&&config.targetPlaybookId?base:[...base,error('FLOW_JUMP_TARGET_REQUIRED','Escolha o fluxo de destino.')];
    }
    case 'distributor':
      return validateConfig(AutomationDistributorConfigSchema,'INVALID_DISTRIBUTOR_CONFIG','Distribuidor inválido');
    case 'notification':
      return validateConfig(AutomationNotificationConfigSchema,'INVALID_NOTIFICATION_CONFIG','Notificação inválida');
    default:
      return [];
  }
}

function distributorRouteIssues(node:AutomationDefinition['nodes'][number],edges:AutomationEdge[]):AutomationIssue[]{
  const issues:AutomationIssue[]=[];const error=(code:string,message:string,edgeId?:string):AutomationIssue=>({level:'error',code,message,nodeId:node.id,...(edgeId?{edgeId}:{})});
  const outputIds=(Array.isArray(node.config.outputs)?node.config.outputs:[]).flatMap(item=>item&&typeof item==='object'&&!Array.isArray(item)&&typeof (item as {id?:unknown}).id==='string'?[(item as {id:string}).id]:[]);const routed=new Set<string>();
  for(const edge of edges){const outputId=edge.condition?.field===DISTRIBUTOR_ROUTE_FIELD&&edge.condition.operator==='equals'&&typeof edge.condition.value==='string'?edge.condition.value:null;if(!outputId||!outputIds.includes(outputId)){issues.push(error('DISTRIBUTOR_ROUTE_INVALID','Cada conexão deve sair por uma opção existente do distribuidor.',edge.id));continue}if(routed.has(outputId))issues.push(error('DISTRIBUTOR_ROUTE_DUPLICATE','Cada saída do distribuidor aceita uma conexão.',edge.id));routed.add(outputId)}
  for(const outputId of outputIds)if(!routed.has(outputId))issues.push(error('DISTRIBUTOR_OUTPUT_UNROUTED',`A saída “${outputId}” não possui conexão.`));return issues;
}

// Nodes with named exits: one edge per port, ports must exist on the node, success is mandatory.
function portIssues(node: AutomationDefinition['nodes'][number], edges: AutomationEdge[], ports: readonly string[]): AutomationIssue[] {
  const issues: AutomationIssue[] = [];
  const error = (code: string, message: string, edgeId?: string): AutomationIssue => ({ level: 'error', code, message, nodeId: node.id, ...(edgeId ? { edgeId } : {}) });
  if (!ports.length) {
    for (const edge of edges) if (edge.port) issues.push(error('EDGE_PORT_INVALID', 'Este bloco não tem saídas de sucesso/erro.', edge.id));
    return issues;
  }
  const used = new Set<string>();
  for (const edge of edges) {
    const port = edgePort(edge);
    if (!ports.includes(port)) { issues.push(error('EDGE_PORT_INVALID', `Saída “${port}” não existe neste bloco.`, edge.id)); continue; }
    if (used.has(port)) issues.push(error('PORT_DUPLICATE_ROUTE', 'Cada saída deste bloco aceita uma conexão.', edge.id));
    used.add(port);
  }
  const required = ports[0]!;
  // Without this exit the flow ends after the block, as in Leona.
  if (edges.length && !used.has(required)) issues.push({ ...error(required === 'reply' ? 'REPLY_ROUTE_REQUIRED' : 'SUCCESS_ROUTE_REQUIRED', required === 'reply' ? 'Sem saída de resposta: quando o contato responder, o fluxo é encerrado.' : 'Sem saída de sucesso: quando der certo, o fluxo é encerrado.'), level: 'warning' });
  return issues;
}

// A menu with per-option exits: every option needs exactly one exit, the only other exit allowed
// is the inactivity one (isDefault).
function menuRouteIssues(node: AutomationDefinition['nodes'][number], edges: AutomationEdge[]): AutomationIssue[] {
  const issues: AutomationIssue[] = [];
  const error = (code: string, message: string, edgeId?: string): AutomationIssue => ({ level: 'error', code, message, nodeId: node.id, ...(edgeId ? { edgeId } : {}) });
  const optionIds = (Array.isArray(node.config.buttons) ? node.config.buttons : [])
    .map(item => item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id : '')
    .filter(Boolean);
  if (edges.filter(edge => edge.isDefault).length > 1) issues.push(error('MENU_TIMEOUT_DUPLICATE', 'O menu aceita apenas uma saída por inatividade.'));
  const routed = new Set<string>();
  for (const edge of edges.filter(item => !item.isDefault)) {
    const condition = edge.condition;
    const optionId = condition?.field === MENU_CHOICE_FIELD && condition.operator === 'equals' && typeof condition.value === 'string' ? condition.value : null;
    if (!optionId || !optionIds.includes(optionId)) { issues.push(error('MENU_ROUTE_INVALID', 'Cada saída do menu precisa estar ligada a uma opção existente.', edge.id)); continue; }
    if (routed.has(optionId)) issues.push(error('MENU_OPTION_DUPLICATE_ROUTE', 'Esta opção do menu já possui uma saída.', edge.id));
    routed.add(optionId);
  }
  for (const optionId of optionIds) if (!routed.has(optionId)) issues.push(error('MENU_OPTION_UNROUTED', `A opção “${optionId}” do menu não possui saída.`));
  return issues;
}

function aiRouteIssues(node: AutomationDefinition['nodes'][number], edges: AutomationEdge[]): AutomationIssue[] {
  const issues: AutomationIssue[] = [];
  const error = (code: string, message: string, edgeId?: string): AutomationIssue => ({ level: 'error', code, message, nodeId: node.id, ...(edgeId ? { edgeId } : {}) });
  const conditionIds = new Set((Array.isArray(node.config.smartConditionals) ? node.config.smartConditionals : []).flatMap(item => item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string' ? [(item as { id: string }).id] : []));
  if (node.config.identifyReceipt === true) conditionIds.add('receipt_valid');
  const used = new Set<string>();
  for (const edge of edges.filter(item => item.condition?.field === AI_ROUTE_FIELD)) {
    const routeId = edge.condition?.operator === 'equals' && typeof edge.condition.value === 'string' ? edge.condition.value : '';
    if (!conditionIds.has(routeId)) { issues.push(error('AI_ROUTE_INVALID', 'A saída da IA não corresponde a uma condicional configurada.', edge.id)); continue; }
    if (used.has(routeId)) issues.push(error('AI_ROUTE_DUPLICATE', 'Cada saída inteligente aceita apenas uma conexão.', edge.id));
    used.add(routeId);
  }
  return issues;
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
    const key = `${edge.source}:${edge.target}:${edge.label ?? ''}:${edgePort(edge)}:${JSON.stringify(edge.condition ?? null)}`;
    if (connectionKeys.has(key)) issues.push({ level: 'error', code: 'DUPLICATE_CONNECTION', message: 'Esta conexão já existe.', edgeId: edge.id });
    connectionKeys.add(key);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }

  for (const node of definition.nodes) {
    const edges = outgoing.get(node.id) ?? [];
    if (terminalKinds.has(node.kind) && edges.length) issues.push({ level: 'error', code: 'TERMINAL_HAS_OUTPUT', message: 'Nós finais não podem ter conexões de saída.', nodeId: node.id });
    if (!terminalKinds.has(node.kind) && edges.length === 0) issues.push({ level: 'warning', code: 'MISSING_OUTPUT', message: 'Sem saída: o fluxo é encerrado depois deste bloco.', nodeId: node.id });
    const ports = nodePorts(node.kind);
    const menuRouted = node.kind === 'buttons' && edges.some(edge => edge.condition !== undefined || edge.isDefault);
    if (node.kind !== 'condition' && node.kind !== 'distributor' && !menuRouted && !ports.length && edges.length > 1) issues.push({ level: 'error', code: 'AMBIGUOUS_OUTPUT', message: 'Somente condições, menus, distribuidores e blocos com sucesso/erro podem ter mais de uma saída.', nodeId: node.id });
    if (menuRouted) issues.push(...menuRouteIssues(node, edges));
    if(node.kind==='distributor')issues.push(...distributorRouteIssues(node,edges));
    if (node.kind === 'ai') {
      const fixedEdges = edges.filter(edge => edge.condition?.field !== AI_ROUTE_FIELD);
      if (edges.length && !fixedEdges.some(edge => edgePort(edge) === 'success')) issues.push({ level: 'error', code: 'AI_SUCCESS_ROUTE_REQUIRED', message: 'O bloco de IA precisa de uma saída de sucesso como rota padrão.', nodeId: node.id });
      issues.push(...portIssues(node, fixedEdges, ports), ...aiRouteIssues(node, edges));
    } else issues.push(...portIssues(node, edges, ports));
    if (node.kind === 'wait_response' && node.config.waitIndefinitely === true) for (const edge of edges) if (edgePort(edge) === 'timeout') issues.push({ level: 'error', code: 'TIMEOUT_ROUTE_INVALID', message: 'Sem tempo limite, o bloco não tem saída de timeout.', nodeId: node.id, edgeId: edge.id });
    if (node.kind === 'condition') {
      // An unconnected branch ends the flow; only duplicated branches are errors.
      const defaults = edges.filter(edge => edge.isDefault).length;
      const conditional = edges.filter(edge => !edge.isDefault);
      const usesNodeRules = Array.isArray(node.config.rules);
      if (defaults > 1) issues.push({ level: 'error', code: 'CONDITION_DEFAULT_REQUIRED', message: 'A condição pode ter só uma saída “Caso contrário”.', nodeId: node.id });
      if (edges.length && !defaults) issues.push({ level: 'warning', code: 'CONDITION_ENDS_FLOW', message: 'Sem saída “Caso contrário”: quando a condição não for atendida, o fluxo é encerrado.', nodeId: node.id });
      else if (edges.length && !conditional.length) issues.push({ level: 'warning', code: 'CONDITION_ENDS_FLOW', message: 'Sem saída “Condição atendida”: quando a condição for atendida, o fluxo é encerrado.', nodeId: node.id });
      if (!usesNodeRules && conditional.some(edge => !edge.condition)) issues.push({ level: 'error', code: 'BRANCH_CONDITION_REQUIRED', message: 'Toda saída não padrão precisa de uma condição.', nodeId: node.id });
      if (usesNodeRules && conditional.length > 1) issues.push({ level: 'error', code: 'CONDITION_SUCCESS_ROUTE_REQUIRED', message: 'A condicional configurada no bloco pode ter só uma saída “Condição atendida”.', nodeId: node.id });
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
  return { valid: !issues.some(issue => issue.level === 'error'), issues, definition };
}

function nodeConditionMatches(node: AutomationDefinition['nodes'][number], variables: Record<string, unknown>) {
  const rules = Array.isArray(node.config.rules) ? node.config.rules as Array<NonNullable<AutomationEdge['condition']>> : [];
  if (!rules.length) return undefined;
  const results = rules.map(rule => conditionMatches(getPathValue(variables, rule.field), rule));
  return node.config.logic === 'any' ? results.some(Boolean) : results.every(Boolean);
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
    if (nodePorts(node.kind).length) selected = candidates.find(edge => edge.condition?.field !== AI_ROUTE_FIELD && edgePort(edge) === nodePorts(node.kind)[0]);
    if (node.kind === 'buttons' && candidates.some(edge => edge.condition !== undefined || edge.isDefault)) {
      // Without a simulated choice, follow the first option so the rest of the path can be checked.
      selected = candidates.find(edge => edge.condition && conditionMatches(getPathValue(variables, edge.condition.field), edge.condition))
        ?? candidates.find(edge => !edge.isDefault) ?? candidates.find(edge => edge.isDefault);
    }
    if(node.kind==='distributor')selected=candidates.find(edge=>edge.condition?.field===DISTRIBUTOR_ROUTE_FIELD);
    if (node.kind === 'condition') {
      const nodeMatch = nodeConditionMatches(node, variables);
      selected = nodeMatch === undefined
        ? candidates.find(edge => edge.condition && conditionMatches(getPathValue(variables, edge.condition.field), edge.condition)) ?? candidates.find(edge => edge.isDefault)
        : nodeMatch ? candidates.find(edge => !edge.isDefault) : candidates.find(edge => edge.isDefault);
    }
    steps.push({ index: steps.length, nodeId: current, kind: node.kind, selectedEdgeId: selected?.id ?? null });
    if (terminalKinds.has(node.kind) || !selected) { current = undefined; break; }
    current = selected.target;
  }
  if (current && steps.length >= definition.settings.maxSteps) stoppedBecause = 'max_steps';
  return { steps, path: steps.map(step => step.nodeId), stoppedBecause };
}
