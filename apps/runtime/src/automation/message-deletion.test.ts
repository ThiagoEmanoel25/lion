import { describe, expect, it, vi } from 'vitest';
import { deleteOnTagIdOf, requestDeletions, type DeletionRule, type DeletionStore } from './message-deletion.js';

function store(pending: DeletionRule[], claimed = new Set<string>()) {
  const requested: string[] = [];
  const impl: DeletionStore = {
    pending: async () => pending,
    claim: async id => (claimed.has(id) ? false : (claimed.add(id), true)),
    request: async rule => { requested.push(rule.id); }
  };
  return { impl, requested };
}

describe('requestDeletions', () => {
  it('pede a exclusão de cada regra pendente', async () => {
    const s = store([{ id: 'r1', messageId: 'm1' }, { id: 'r2', messageId: 'm2' }]);
    await expect(requestDeletions('c1', ['tag-1'], s.impl)).resolves.toEqual(['r1', 'r2']);
    expect(s.requested).toEqual(['r1', 'r2']);
  });

  it('aplicar a etiqueta duas vezes não pede a exclusão duas vezes', async () => {
    const claimed = new Set<string>();
    const first = store([{ id: 'r1', messageId: 'm1' }], claimed);
    await requestDeletions('c1', ['tag-1'], first.impl);
    const second = store([{ id: 'r1', messageId: 'm1' }], claimed);
    await expect(requestDeletions('c1', ['tag-1'], second.impl)).resolves.toEqual([]);
    expect(second.requested).toEqual([]);
  });

  it('não consulta o banco quando o bloco não aplicou nenhuma etiqueta', async () => {
    const pending = vi.fn();
    await expect(requestDeletions('c1', [], { pending, claim: async () => true, request: async () => undefined })).resolves.toEqual([]);
    expect(pending).not.toHaveBeenCalled();
  });

  it('ignora etiquetas repetidas e vazias', async () => {
    const pending = vi.fn(async () => []);
    await requestDeletions('c1', ['tag-1', 'tag-1', ''], { pending, claim: async () => true, request: async () => undefined });
    expect(pending).toHaveBeenCalledWith('c1', ['tag-1']);
  });
});

describe('deleteOnTagIdOf', () => {
  it('lê a etiqueta do payload', () => { expect(deleteOnTagIdOf({ deleteOnTagId: 'tag-1' })).toBe('tag-1'); });
  it('devolve undefined para payload sem a marca, nulo ou de outro formato', () => {
    expect(deleteOnTagIdOf({ typingSeconds: 3 })).toBeUndefined();
    expect(deleteOnTagIdOf(null)).toBeUndefined();
    expect(deleteOnTagIdOf([{ deleteOnTagId: 'tag-1' }])).toBeUndefined();
    expect(deleteOnTagIdOf({ deleteOnTagId: 42 })).toBeUndefined();
    expect(deleteOnTagIdOf({ deleteOnTagId: '' })).toBeUndefined();
  });
});
