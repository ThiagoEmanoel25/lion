// Edge selection and interpolation, shared by the real runtime (apps/runtime/src/automation/routing.ts
// re-exports these) and the pure simulator, so the two can never drift apart.
import { conditionMatches, getPathValue, type ConditionOperator } from './conditions.js';

export type FlowCondition = { field: string; operator: ConditionOperator; value?: unknown };
export type FlowNode = { id: string; kind: string; name?: string; config?: Record<string, unknown> };
export type FlowEdge = { id: string; source: string; target: string; label?: string; condition?: FlowCondition; isDefault?: boolean; priority: number; port?: string };

export function selectNextEdge<E extends FlowEdge>(node: FlowNode, edges: E[], context: Record<string, unknown>): E | undefined {
  const candidates = edges.filter(edge => edge.source === node.id).sort((a, b) => a.priority - b.priority);
  if (node.kind === 'buttons' && routesByChoice(node, edges)) {
    return candidates.find(edge => edge.condition && conditionMatches(getPathValue(context, edge.condition.field), edge.condition))
      ?? candidates.find(edge => edge.isDefault);
  }
  if (node.kind !== 'condition') return candidates[0];
  const rules = Array.isArray(node.config?.rules) ? node.config.rules as FlowCondition[] : [];
  if (rules.length) {
    const results = rules.map(rule => conditionMatches(getPathValue(context, rule.field), rule));
    const matches = node.config?.logic === 'any' ? results.some(Boolean) : results.every(Boolean);
    return matches ? candidates.find(edge => !edge.isDefault) : candidates.find(edge => edge.isDefault);
  }
  return candidates.find(edge => edge.condition && conditionMatches(getPathValue(context, edge.condition.field), edge.condition))
    ?? candidates.find(edge => edge.isDefault);
}

export function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, path: string) => {
    const value = getPathValue(context, path);
    if (value === undefined || value === null) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}

export type MenuOption = { id: string; label: string };

// A menu waits for the reply only when its exits are wired per option (or has an inactivity exit).
// Older flows with one plain exit keep the send-and-continue behaviour.
export function routesByChoice(node: FlowNode, edges: FlowEdge[]): boolean {
  return node.kind === 'buttons' && edges.some(edge => edge.source === node.id && (edge.condition !== undefined || edge.isDefault));
}

export function menuOptions(node: FlowNode): MenuOption[] {
  const raw = Array.isArray(node.config?.buttons) ? node.config.buttons : [];
  return raw.flatMap(item => {
    const option = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
    return typeof option.id === 'string' && typeof option.label === 'string' ? [{ id: option.id, label: option.label }] : [];
  });
}

// Tapping sends the option id; contacts on clients without interactive support type the label or its number.
export function resolveMenuChoice(options: MenuOption[], reply: { id?: string | null; text?: string | null }): MenuOption | null {
  if (reply.id) {
    const byId = options.find(option => option.id === reply.id);
    if (byId) return byId;
  }
  const typed = reply.text?.trim().toLocaleLowerCase('pt-BR');
  if (!typed) return null;
  const byLabel = options.find(option => option.label.trim().toLocaleLowerCase('pt-BR') === typed);
  if (byLabel) return byLabel;
  const index = /^\d{1,2}$/.test(typed) ? Number(typed) - 1 : -1;
  return options[index] ?? null;
}

export function setContextPath<T extends Record<string, unknown>>(context: T, path: string, value: unknown): T {
  const next = structuredClone(context) as Record<string, unknown>;
  const parts = path.split('.');
  // Shared sink (webhook, AI, manipulator): never walk into Object.prototype.
  if (parts.some(part => part === '__proto__' || part === 'constructor' || part === 'prototype')) return next as T;
  let current = next;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) current[part] = value;
    else {
      const child = current[part];
      current[part] = child && typeof child === 'object' && !Array.isArray(child) ? child : {};
      current = current[part] as Record<string, unknown>;
    }
  });
  return next as T;
}
