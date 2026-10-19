import { createHash } from 'node:crypto';

// PostgreSQL jsonb does not preserve object key order. Canonicalizing recursively
// keeps the digest stable after a definition is persisted and read back.
function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map(key => [key, canonicalJson((value as Record<string, unknown>)[key])])
  );
}

export function definitionChecksum(definition: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalJson(definition))).digest('hex');
}
