import { describe, expect, it } from 'vitest';
import { definitionChecksum } from './checksum.js';

describe('definitionChecksum', () => {
  it('ignora a ordem das propriedades em objetos aninhados', () => {
    const first = { start: 'a', settings: { timeoutSeconds: 300, maxSteps: 20 }, nodes: [{ id: 'a', config: { event: 'message', enabled: true } }] };
    const reordered = { nodes: [{ config: { enabled: true, event: 'message' }, id: 'a' }], settings: { maxSteps: 20, timeoutSeconds: 300 }, start: 'a' };
    expect(definitionChecksum(first)).toBe(definitionChecksum(reordered));
  });

  it('preserva a ordem de arrays porque ela altera o fluxo', () => {
    expect(definitionChecksum({ nodes: ['a', 'b'] })).not.toBe(definitionChecksum({ nodes: ['b', 'a'] }));
  });
});
