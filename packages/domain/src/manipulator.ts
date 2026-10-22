export const MANIPULATOR_OPERATIONS = ['set', 'add', 'subtract', 'multiply', 'divide'] as const;
export type Operation = typeof MANIPULATOR_OPERATIONS[number];

const NAME = /^[A-Za-z0-9_.-]{1,60}$/;
const RESERVED = /^(_runtime|workspace|contact\.id)(\.|$)|(^|\.)(password|secret|token|apikey|api_key|credential|credentials|authorization)(\.|$)/i;

// Targets: `contact.customFields.<name>` (persisted) or `flow.<path>` (execution context only).
export function parseTarget(target: string): { scope: 'contact' | 'flow'; path: string } | null {
  const t = target.trim();
  const contact = t.startsWith('contact.customFields.');
  const flow = t.startsWith('flow.');
  if (!contact && !flow) return null;
  const path = t.slice(contact ? 'contact.customFields.'.length : 'flow.'.length);
  if (!NAME.test(path) || path.startsWith('.') || path.endsWith('.') || path.includes('..') || RESERVED.test(path)) return null;
  return { scope: contact ? 'contact' : 'flow', path };
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') { const n = Number(value); return Number.isFinite(n) ? n : null; }
  return null;
}

export function applyManipulation(current: unknown, operation: Operation, operand: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (operation === 'set') {
    const text = operand.trim();
    try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: true, value: operand }; }
  }
  const missing = current === undefined || current === null;
  if (missing && operation !== 'add' && operation !== 'subtract') return { ok: false, reason: 'O campo precisa ter um valor para esta operação.' };
  const left = missing ? 0 : toNumber(current);
  const right = toNumber(operand);
  if (left === null) return { ok: false, reason: 'O valor atual não é numérico.' };
  if (right === null) return { ok: false, reason: 'O valor informado não é numérico.' };
  if (operation === 'divide' && right === 0) return { ok: false, reason: 'Divisão por zero.' };
  const value = operation === 'add' ? left + right : operation === 'subtract' ? left - right : operation === 'multiply' ? left * right : left / right;
  return Number.isFinite(value) ? { ok: true, value } : { ok: false, reason: 'Resultado numérico inválido.' };
}
