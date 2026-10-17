import { extractResponseField } from '@nexo/contracts';
import { setContextPath } from './routing.js';

export type ResponseField = { path: string; variable: string };
type Context = Record<string, unknown>;
export type IntegrationResult = { port: 'success' | 'failure'; context: Context; output: Record<string, unknown> };

export function parseResponseFields(value: unknown): ResponseField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const field = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return typeof field.path === 'string' && field.path.trim() && typeof field.variable === 'string' && field.variable.trim()
      ? [{ path: field.path.trim(), variable: field.variable.trim() }]
      : [];
  }).slice(0, 20);
}

// Decides the exit of an Integração block from the HTTP result and writes the response into the context.
export function integrationOutcome(input: { context: Context; status: number | null; body: string | null; headers?: Record<string, string>; error?: string; responseVariable?: string; responseFields: ResponseField[] }): IntegrationResult {
  const failure = (context: Context, message: string): IntegrationResult => ({
    port: 'failure',
    context: setContextPath(context, 'integration.error', { status: input.status, message }),
    output: { status: input.status, error: message }
  });
  if (input.error) return failure(input.context, input.error);
  let parsed: unknown = input.body;
  try { parsed = input.body ? JSON.parse(input.body) : null; } catch { /* textual response */ }
  const context: Context = { ...input.context, webhook: { status: input.status, body: parsed } };
  if (input.status === null || input.status < 200 || input.status > 299) return failure(context, `A integração respondeu HTTP ${input.status}.`);
  if (input.responseFields.length && (parsed === null || typeof parsed !== 'object')) return failure(context, 'A resposta da integração não é JSON.');
  let next = input.responseVariable ? setContextPath(context, input.responseVariable, parsed) : context;
  const source = { status: input.status, body: parsed, headers: input.headers ?? {} };
  for (const field of input.responseFields) next = setContextPath(next, field.variable, extractResponseField(source, field.path).value);
  return { port: 'success', context: next, output: { status: input.status, body: input.body } };
}
