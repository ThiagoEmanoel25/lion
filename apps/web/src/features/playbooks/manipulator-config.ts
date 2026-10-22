// Mirrors packages/domain/src/manipulator.ts (parseTarget, MANIPULATOR_OPERATIONS); declared here so the web bundle imports no runtime values from the packages.
export type ManipulatorOperation = 'set' | 'add' | 'subtract' | 'multiply' | 'divide';
export const MANIPULATOR_OPERATION_LABELS: Record<ManipulatorOperation, string> = { set: 'Definir valor', add: 'Somar', subtract: 'Subtrair', multiply: 'Multiplicar', divide: 'Dividir' };
export const CONTACT_FIELD_PREFIX = 'contact.customFields.';
export const FLOW_PREFIX = 'flow.';

const NAME = /^[A-Za-z0-9_.-]{1,60}$/;
const RESERVED = /^(_runtime|workspace|global|contact\.id)(\.|$)|(^|\.)(__proto__|constructor|prototype)(\.|$)|(^|\.)(password|secret|token|apikey|api_key|credential|credentials|authorization)(\.|$)/i;

export function splitTarget(target: string): { scope: 'contact' | 'flow'; name: string } {
  return target.startsWith(FLOW_PREFIX) ? { scope: 'flow', name: target.slice(FLOW_PREFIX.length) } : { scope: 'contact', name: target.startsWith(CONTACT_FIELD_PREFIX) ? target.slice(CONTACT_FIELD_PREFIX.length) : '' };
}

export function manipulatorError(name: string, value: string): string {
  if (!NAME.test(name) || name.startsWith('.') || name.endsWith('.') || name.includes('..') || RESERVED.test(name)) return 'Use de 1 a 60 caracteres (letras, números, _, - e .), sem nomes reservados.';
  if (/\{\{\s*global[.\s}]/i.test(value)) return 'Variáveis globais não podem ser gravadas pelo Manipulador.';
  return '';
}

export function manipulatorSummary(config: Record<string, unknown>): string {
  const { name } = splitTarget(String(config.target ?? ''));
  const value = String(config.value ?? '');
  if (!name) return 'Escolha o campo ou a variável';
  switch (config.operation) {
    case 'set': return `Definir ${name} = ${value}`;
    case 'add': return `Somar ${value} a ${name}`;
    case 'subtract': return `Subtrair ${value} de ${name}`;
    case 'multiply': return `Multiplicar ${name} por ${value}`;
    case 'divide': return `Dividir ${name} por ${value}`;
    default: return 'Escolha a operação';
  }
}
