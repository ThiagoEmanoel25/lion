import { getPathValue } from './conditions.js';

// Reads a field of an Integração response ({ status, body, headers }) by dotted path. `found` is false only when the path does not exist.
export function extractResponseField(response: { status: number; body: unknown; headers: Record<string, string> }, path: string): { found: boolean; value: unknown } {
  const value = getPathValue(response, path);
  return { found: value !== undefined, value };
}

// Same {{path}} substitution as message templates, but values are URL-encoded (headers and body are not).
export function renderUrlTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, path: string) => {
    const value = getPathValue(context, path);
    if (value === undefined || value === null) return '';
    return encodeURIComponent(typeof value === 'object' ? JSON.stringify(value) : String(value));
  });
}

// Suggestions for the mapping path field: `status` plus every leaf of the response body ("body.a.b", arrays by index), capped.
export function responsePaths(response: { status: number; body: unknown }, limit = 50): string[] {
  const paths = ['status'];
  const walk = (value: unknown, path: string) => {
    if (paths.length >= limit) return;
    if (value && typeof value === 'object') { for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`); return; }
    paths.push(path);
  };
  walk(response.body, 'body');
  return paths.slice(0, limit);
}
