import type { z } from 'zod';
import { AI_ROUTE_FIELD, conditionMatches, edgePort, getPathValue, MENU_DEFAULT_TIMEOUT_SECONDS, MENU_MAX_TIMEOUT_SECONDS, type AutomationDefinitionSchema, type EdgePort } from '@nexo/contracts';

export { conditionMatches, getPathValue };
// Edge selection, interpolation and context writes live in @nexo/domain so the pure simulator
// (packages/domain/src/simulation.ts) walks flows with exactly this logic. Re-exported unchanged.
export { menuOptions, renderTemplate, resolveMenuChoice, routesByChoice, selectNextEdge, setContextPath, type MenuOption } from '@nexo/domain';
import { setContextPath } from '@nexo/domain';

export type AutomationDefinition = z.infer<typeof AutomationDefinitionSchema>;
export type AutomationNode = AutomationDefinition['nodes'][number];
export type AutomationEdge = AutomationDefinition['edges'][number];

export function menuTimeoutSeconds(node: AutomationNode): number {
  const value = node.config.timeoutSeconds;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return MENU_DEFAULT_TIMEOUT_SECONDS;
  return Math.min(value, MENU_MAX_TIMEOUT_SECONDS);
}

export function setAiResponseContext<T extends Record<string, unknown>>(context: T, responseVariable: string, response: string): T {
  const canonical = setContextPath(context, 'ai.response', response);
  return responseVariable === 'ai.response' ? canonical : setContextPath(canonical, responseVariable, response);
}

export function selectPortEdge(edges: AutomationEdge[], nodeId: string, port: EdgePort): AutomationEdge | undefined {
  return edges.find(edge => edge.source === nodeId && edge.condition?.field !== AI_ROUTE_FIELD && edgePort(edge) === port);
}

export function selectAiRouteEdge(edges: AutomationEdge[], nodeId: string, routeId: string | null): AutomationEdge | undefined {
  if (routeId) {
    const routed = edges.find(edge => edge.source === nodeId && edge.condition?.field === AI_ROUTE_FIELD && edge.condition.operator === 'equals' && edge.condition.value === routeId);
    if (routed) return routed;
  }
  return selectPortEdge(edges, nodeId, 'success');
}
