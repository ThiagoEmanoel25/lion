import { describe, expect, it } from 'vitest';
import { filterFlows, formatUpdated, sortFlows } from './flows-list';

const flows = [
  { name: 'Qualificação Comercial', status: 'PUBLISHED' as const, folderId: null },
  { name: 'Reativação', status: 'PAUSED' as const, folderId: 'f1' },
  { name: 'Rascunho', status: 'DRAFT' as const, folderId: null },
  { name: 'Antigo', status: 'ARCHIVED' as const, folderId: null }
];

describe('filterFlows', () => {
  it('filtra pela pasta, com null para Sem pasta', () => {
    expect(filterFlows(flows, { folderId: null, query: '', status: 'all' }).map(item => item.name)).toEqual(['Qualificação Comercial', 'Rascunho']);
    expect(filterFlows(flows, { folderId: 'f1', query: '', status: 'all' }).map(item => item.name)).toEqual(['Reativação']);
  });
  it('busca sem diferenciar acentos e maiúsculas', () => {
    expect(filterFlows(flows, { folderId: null, query: 'QUALIFICACAO', status: 'all' }).map(item => item.name)).toEqual(['Qualificação Comercial']);
  });
  it('separa ativos e pausados; Todos inclui rascunhos e exclui arquivados', () => {
    expect(filterFlows(flows, { folderId: null, query: '', status: 'active' }).map(item => item.name)).toEqual(['Qualificação Comercial']);
    expect(filterFlows(flows, { folderId: 'f1', query: '', status: 'paused' }).map(item => item.name)).toEqual(['Reativação']);
    expect(filterFlows(flows, { folderId: null, query: '', status: 'archived' }).map(item => item.name)).toEqual(['Antigo']);
  });
});

describe('formatUpdated', () => {
  it('usa dd/mm/aaaa, hh:mm', () => {
    expect(formatUpdated(new Date(2026, 9, 8, 7, 5).toISOString())).toBe('08/10/2026, 07:05');
  });
});

describe('sortFlows', () => {
  const items = [
    { name: 'Beta', updatedAt: '2026-11-01T10:00:00.000Z' },
    { name: 'Ágil', updatedAt: '2026-11-20T10:00:00.000Z' },
    { name: 'Casa', updatedAt: '2026-11-24T10:00:00.000Z' }
  ];
  it('mais recentes primeiro', () => {
    expect(sortFlows(items, 'recent').map(item => item.name)).toEqual(['Casa', 'Ágil', 'Beta']);
  });
  it('por nome, respeitando acentos', () => {
    expect(sortFlows(items, 'name').map(item => item.name)).toEqual(['Ágil', 'Beta', 'Casa']);
  });
  it('não altera a lista original', () => {
    const copy = [...items];
    sortFlows(items, 'name');
    expect(items).toEqual(copy);
  });
});
