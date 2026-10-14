import type { z } from 'zod';
import type { AutomationDefinitionSchema } from '@nexo/contracts';

export type AutomationDefinition = z.infer<typeof AutomationDefinitionSchema>;
export type AutomationNode = AutomationDefinition['nodes'][number];
export type AutomationEdge = AutomationDefinition['edges'][number];

export function getPathValue(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => current && typeof current === 'object'
    ? (current as Record<string, unknown>)[part]
    : undefined, source);
}

export function conditionMatches(value: unknown, condition: NonNullable<AutomationEdge['condition']>): boolean {
  const expected = condition.value;
  switch (condition.operator) {
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

export function selectNextEdge(node: AutomationNode, edges: AutomationEdge[], context: Record<string, unknown>): AutomationEdge | undefined {
  const candidates = edges.filter(edge => edge.source === node.id).sort((a, b) => a.priority - b.priority);
  if (node.kind !== 'condition') return candidates[0];
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
