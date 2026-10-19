import { describe, expect, it } from 'vitest';
import { filterFlows, formatUpdated } from './flows-list';

const flows = [
  { name: 'Qualificação Comercial', status: 'PUBLISHED' as const, folderId: null },
  { name: 'Reativação', status: 'PAUSED' as const, folderId: 'f1' },
  { name: 'Rascunho', status: 'DRAFT' as const, folderId: null },
  { name: 'Antigo', status: 'ARCHIVED' as const, folderId: null }
];

describe('filterFlows', () => {
  it('filtra pela pasta, com null para Sem pasta', () => {
    expect(filterFlows(flows, { folderId: null, query: '', status: 'all' }).map(item => item.name)).toEqual(['Qualificação Comercial', 'Rascunho', 'Antigo']);
    expect(filterFlows(flows, { folderId: 'f1', query: '', status: 'all' }).map(item => item.name)).toEqual(['Reativação']);
  });
  it('busca sem diferenciar acentos e maiúsculas', () => {
    expect(filterFlows(flows, { folderId: null, query: 'QUALIFICACAO', status: 'all' }).map(item => item.name)).toEqual(['Qualificação Comercial']);
  });
  it('separa ativos e pausados; Todos inclui rascunhos e arquivados', () => {
    expect(filterFlows(flows, { folderId: null, query: '', status: 'active' }).map(item => item.name)).toEqual(['Qualificação Comercial']);
    expect(filterFlows(flows, { folderId: 'f1', query: '', status: 'paused' }).map(item => item.name)).toEqual(['Reativação']);
  });
});

describe('formatUpdated', () => {
  it('usa dd/mm/aaaa, hh:mm', () => {
    expect(formatUpdated(new Date(2026, 9, 8, 7, 5).toISOString())).toBe('08/10/2026, 07:05');
  });
});
