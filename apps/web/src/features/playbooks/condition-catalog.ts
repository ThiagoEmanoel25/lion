// Condition types offered by the Condicional block. Mirrors the operators of
// packages/contracts/src/conditions.ts; declared here so the web bundle does not pull zod in.
export type ConditionOperator = 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'exists' | 'not_exists' | 'greater_than' | 'less_than' | 'in' | 'not_in' | 'between' | 'not_between';
export type ConditionRule = { field: string; operator: ConditionOperator; value?: unknown };
export type ConditionGroup = 'Sistema' | 'Atendimento' | 'Atendente' | 'Campos';
export type ValueKind = 'tags' | 'members' | 'kanbanColumns' | 'weekdays' | 'timeRange' | 'date' | 'dateRange' | 'boolean' | 'text' | 'none';
export type ConditionItem = { key: string; group: ConditionGroup; label: string; operators: Array<{ value: ConditionOperator; label: string }>; create: () => ConditionRule };

export const CONDITION_GROUPS: ConditionGroup[] = ['Sistema', 'Atendimento', 'Atendente', 'Campos'];
export const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const CUSTOM_FIELD_PREFIX = 'contact.customFields.';

const TEXT_OPERATORS: ConditionItem['operators'] = [
  { value: 'equals', label: 'é igual a' }, { value: 'not_equals', label: 'é diferente de' },
  { value: 'contains', label: 'contém' }, { value: 'not_contains', label: 'não contém' },
  { value: 'exists', label: 'está preenchido' }, { value: 'not_exists', label: 'está vazio' }
];
const STATUS_OPERATORS: ConditionItem['operators'] = [{ value: 'equals', label: 'está' }, { value: 'not_equals', label: 'não está' }];
const status = (key: string, label: string, value: string): ConditionItem => ({ key, group: 'Atendimento', label, operators: STATUS_OPERATORS, create: () => ({ field: 'conversation.status', operator: 'equals', value }) });
const text = (key: string, label: string, field: string): ConditionItem => ({ key, group: 'Campos', label, operators: TEXT_OPERATORS, create: () => ({ field, operator: 'equals', value: '' }) });

export const CONDITION_ITEMS: ConditionItem[] = [
  { key: 'tag', group: 'Sistema', label: 'Etiqueta', operators: [{ value: 'in', label: 'possui alguma das' }, { value: 'not_in', label: 'não possui nenhuma das' }], create: () => ({ field: 'contact.tagIds', operator: 'in', value: [] }) },
  { key: 'weekday', group: 'Sistema', label: 'Dia da semana', operators: [{ value: 'in', label: 'é um dos dias' }, { value: 'not_in', label: 'não é um dos dias' }], create: () => ({ field: 'system.weekday', operator: 'in', value: [1, 2, 3, 4, 5] }) },
  { key: 'time', group: 'Sistema', label: 'Hora', operators: [{ value: 'between', label: 'entre' }, { value: 'not_between', label: 'fora de' }], create: () => ({ field: 'system.time', operator: 'between', value: ['08:00', '18:00'] }) },
  { key: 'date', group: 'Sistema', label: 'Data', operators: [{ value: 'equals', label: 'é' }, { value: 'greater_than', label: 'depois de' }, { value: 'less_than', label: 'antes de' }, { value: 'between', label: 'entre' }], create: () => ({ field: 'system.date', operator: 'equals', value: '' }) },
  { key: 'window24h', group: 'Sistema', label: 'Janela de 24h', operators: [{ value: 'equals', label: 'está' }], create: () => ({ field: 'conversation.window24h', operator: 'equals', value: true }) },
  status('waiting', 'Aguardando', 'QUEUED'),
  status('attending', 'Atendendo', 'ASSIGNED'),
  status('resolved', 'Resolvidos', 'RESOLVED'),
  { key: 'kanban', group: 'Atendimento', label: 'Coluna do Kanban', operators: [{ value: 'in', label: 'está em uma das' }, { value: 'not_in', label: 'não está em nenhuma das' }], create: () => ({ field: 'kanban.', operator: 'in', value: [] }) },
  { key: 'assignee', group: 'Atendente', label: 'Atendente ativo do chat (lista)', operators: [{ value: 'in', label: 'é um dos' }, { value: 'not_in', label: 'não é nenhum dos' }], create: () => ({ field: 'conversation.assigneeId', operator: 'in', value: [] }) },
  text('name', 'Nome', 'contact.name'),
  text('phone', 'Número', 'contact.phone'),
  text('email', 'Email', 'contact.email'),
  { key: 'custom', group: 'Campos', label: 'Campo personalizado', operators: TEXT_OPERATORS, create: () => ({ field: CUSTOM_FIELD_PREFIX, operator: 'equals', value: '' }) },
  { key: 'variable', group: 'Campos', label: 'Variável do fluxo', operators: [...TEXT_OPERATORS, { value: 'greater_than', label: 'maior que' }, { value: 'less_than', label: 'menor que' }], create: () => ({ field: '', operator: 'equals', value: '' }) }
];

const byKey = (key: string) => CONDITION_ITEMS.find(item => item.key === key)!;
const FIELD_ITEMS: Record<string, string> = { 'contact.tagIds': 'tag', 'system.weekday': 'weekday', 'system.time': 'time', 'system.date': 'date', 'conversation.window24h': 'window24h', 'conversation.assigneeId': 'assignee', 'contact.name': 'name', 'contact.phone': 'phone', 'contact.email': 'email' };
const STATUS_ITEMS: Record<string, string> = { QUEUED: 'waiting', ASSIGNED: 'attending', RESOLVED: 'resolved' };

export function itemForRule(rule: ConditionRule): ConditionItem {
  if(/^kanban\.[^.]+\.columnId$/.test(rule.field)||rule.field==='kanban.')return byKey('kanban');
  if (rule.field === 'conversation.status' && typeof rule.value === 'string' && Object.hasOwn(STATUS_ITEMS, rule.value)) return byKey(STATUS_ITEMS[rule.value]!);
  if (Object.hasOwn(FIELD_ITEMS, rule.field)) return byKey(FIELD_ITEMS[rule.field]!);
  if (rule.field.startsWith(CUSTOM_FIELD_PREFIX)) return byKey('custom');
  return byKey('variable');
}

export function valueKind(item: ConditionItem, operator: ConditionOperator): ValueKind {
  switch (item.key) {
    case 'tag': return 'tags';
    case 'assignee': return 'members';
    case 'kanban': return 'kanbanColumns';
    case 'weekday': return 'weekdays';
    case 'time': return 'timeRange';
    case 'date': return operator === 'between' ? 'dateRange' : 'date';
    case 'window24h': return 'boolean';
    case 'waiting': case 'attending': case 'resolved': return 'none';
    default: return operator === 'exists' || operator === 'not_exists' ? 'none' : 'text';
  }
}

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function searchConditionItems(query: string): ConditionItem[] {
  const term = fold(query);
  if (!term) return CONDITION_ITEMS;
  return CONDITION_ITEMS.filter(item => fold(item.label).includes(term) || fold(item.group).includes(term));
}

const TIME = /^\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PATH = /^[A-Za-z_][\w.-]*$/;
const isPair = (value: unknown, pattern: RegExp) => Array.isArray(value) && value.length === 2 && value.every(part => typeof part === 'string' && pattern.test(part));

export function ruleError(rule: ConditionRule): string {
  const item = itemForRule(rule);
  if (item.key === 'custom' && !PATH.test(rule.field.slice(CUSTOM_FIELD_PREFIX.length))) return 'Informe a chave do campo personalizado.';
  if (item.key === 'variable' && !PATH.test(rule.field)) return 'Informe o caminho da variável (ex.: menu.choice).';
  switch (valueKind(item, rule.operator)) {
    case 'tags': return Array.isArray(rule.value) && rule.value.length ? '' : 'Selecione ao menos uma etiqueta.';
    case 'members': return Array.isArray(rule.value) && rule.value.length ? '' : 'Selecione ao menos um atendente.';
    case 'kanbanColumns': return /^kanban\.[^.]+\.columnId$/.test(rule.field)&&Array.isArray(rule.value)&&rule.value.length ? '' : 'Selecione um quadro e ao menos uma coluna.';
    case 'weekdays': return Array.isArray(rule.value) && rule.value.length ? '' : 'Selecione ao menos um dia.';
    case 'timeRange': return isPair(rule.value, TIME) ? '' : 'Informe o horário inicial e final.';
    case 'date': return typeof rule.value === 'string' && DATE.test(rule.value) ? '' : 'Informe a data.';
    case 'dateRange':
      if (!isPair(rule.value, DATE)) return 'Informe a data inicial e final.';
      return (rule.value as string[])[0]! > (rule.value as string[])[1]! ? 'A data inicial deve ser anterior ou igual à final.' : '';
    case 'text': return rule.value !== undefined && rule.value !== null && String(rule.value).trim() !== '' ? '' : 'Informe o valor para comparar.';
    default: return '';
  }
}

// Ordering operators only compare number-number or string-string, so numeric text must be stored as a number.
export function coerceRuleValue(operator: ConditionOperator, input: string): unknown {
  return (operator === 'greater_than' || operator === 'less_than') && input.trim() !== '' && Number.isFinite(Number(input)) ? Number(input) : input;
}

// One-line Leona-style description of a rule for the canvas, e.g. "Etiqueta igual VIP".
export function ruleSummary(rule: ConditionRule, nameOf: (id: string) => string | undefined = () => undefined): string {
  const item = itemForRule(rule);
  if (valueKind(item, rule.operator) === 'none' && item.group === 'Atendimento') return `Atendimento ${rule.operator === 'not_equals' ? 'não está' : 'está'} em ${item.label}`;
  const label = item.key === 'variable' ? rule.field || 'Variável' : item.key === 'custom' ? rule.field.slice(CUSTOM_FIELD_PREFIX.length) || 'Campo' : item.label;
  const operator = item.key === 'tag' ? (rule.operator === 'not_in' ? 'diferente de' : 'igual') : item.operators.find(option => option.value === rule.operator)?.label ?? rule.operator;
  const list = Array.isArray(rule.value) ? rule.value : [];
  let value: string;
  switch (valueKind(item, rule.operator)) {
    case 'kanbanColumns': value = `${list.length} coluna(s)`; break;
    case 'tags': case 'members': value = list.map(id => nameOf(String(id)) ?? String(id)).join(', '); break;
    case 'weekdays': value = list.map(day => WEEKDAY_LABELS[Number(day)] ?? String(day)).join(', '); break;
    case 'timeRange': case 'dateRange': value = list.join('–'); break;
    case 'boolean': value = rule.value === false ? 'fechada' : 'aberta'; break;
    case 'none': value = ''; break;
    default: value = rule.value === undefined || rule.value === null ? '' : String(rule.value);
  }
  return [label, operator, value].filter(Boolean).join(' ');
}
