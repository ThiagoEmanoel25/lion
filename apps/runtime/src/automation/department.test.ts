import { describe, expect, it } from 'vitest';
import { AssignmentError, resolveAssignment, type DepartmentLookups } from './department.js';

const lookups = (overrides: Partial<DepartmentLookups> = {}): DepartmentLookups => ({
  department: async id => (id === 'dep-1' ? { id: 'dep-1', name: 'Vendas' } : null),
  isWorkspaceMember: async userId => userId === 'user-1',
  ...overrides
});

describe('resolveAssignment', () => {
  it('grava o nome atual do departamento em queue', async () => {
    await expect(resolveAssignment({ departmentId: 'dep-1' }, lookups())).resolves.toEqual({ departmentId: 'dep-1', queue: 'Vendas' });
  });

  it('usa o nome do cadastro, não o que estava salvo na config', async () => {
    const result = await resolveAssignment({ departmentId: 'dep-1', queue: 'Nome Antigo' }, lookups());
    expect(result.queue).toBe('Vendas');
  });

  it('recusa um departamento que não existe mais', async () => {
    await expect(resolveAssignment({ departmentId: 'apagado' }, lookups())).rejects.toMatchObject({ code: 'DEPARTMENT_NOT_FOUND' });
  });

  it('recusa um departamento de outro workspace, que o lookup não encontra', async () => {
    await expect(resolveAssignment({ departmentId: 'dep-de-outro' }, lookups())).rejects.toBeInstanceOf(AssignmentError);
  });

  it('mantém a fila em texto de fluxos legados sem departmentId', async () => {
    await expect(resolveAssignment({ queue: ' Suporte ' }, lookups())).resolves.toEqual({ departmentId: null, queue: 'Suporte' });
  });

  it('recusa um responsável fora do workspace', async () => {
    await expect(resolveAssignment({ assigneeId: 'intruso' }, lookups())).rejects.toMatchObject({ code: 'INVALID_ASSIGNEE' });
  });

  it('aceita departamento e responsável juntos', async () => {
    await expect(resolveAssignment({ departmentId: 'dep-1', assigneeId: 'user-1' }, lookups())).resolves.toEqual({ departmentId: 'dep-1', queue: 'Vendas', assigneeId: 'user-1' });
  });

  it('exige ao menos um alvo', async () => {
    await expect(resolveAssignment({ departmentId: '  ', queue: '' }, lookups())).rejects.toMatchObject({ code: 'ASSIGN_TARGET_REQUIRED' });
  });
});
