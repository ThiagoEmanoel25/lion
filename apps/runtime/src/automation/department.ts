// Departamento e responsável são resolvidos no momento da execução, sempre dentro do workspace:
// uma config salva meses atrás pode apontar para um departamento renomeado, desativado ou apagado.
// "queue" continua sendo gravado com o nome atual, para a listagem do inbox e para fluxos legados.
export type DepartmentTarget = { departmentId?: string; assigneeId?: string; queue?: string };
export type DepartmentLookups = {
  department: (id: string) => Promise<{ id: string; name: string } | null>;
  isWorkspaceMember: (userId: string) => Promise<boolean>;
};
export type DepartmentAssignment = { departmentId: string | null; queue: string | null; assigneeId?: string };

export class AssignmentError extends Error {
  constructor(readonly code: 'ASSIGN_TARGET_REQUIRED' | 'DEPARTMENT_NOT_FOUND' | 'INVALID_ASSIGNEE', message: string) { super(message); }
}

export async function resolveAssignment(target: DepartmentTarget, lookups: DepartmentLookups): Promise<DepartmentAssignment> {
  const departmentId = target.departmentId?.trim() || undefined;
  const assigneeId = target.assigneeId?.trim() || undefined;
  const queue = target.queue?.trim() || undefined;
  if (!departmentId && !assigneeId && !queue) throw new AssignmentError('ASSIGN_TARGET_REQUIRED', 'Informe um departamento ou responsável.');
  if (assigneeId && !await lookups.isWorkspaceMember(assigneeId)) throw new AssignmentError('INVALID_ASSIGNEE', 'O responsável não pertence ao workspace.');
  if (!departmentId) return { departmentId: null, queue: queue ?? null, ...(assigneeId ? { assigneeId } : {}) };
  // A busca já é escopada no workspace por quem monta os lookups; um id de outro workspace não é encontrado.
  const department = await lookups.department(departmentId);
  if (!department) throw new AssignmentError('DEPARTMENT_NOT_FOUND', 'O departamento escolhido não existe mais neste workspace.');
  // Departamento desativado continua recebendo: derrubar a execução por uma mudança de cadastro é pior
  // que atribuir a um departamento inativo, que o editor já sinaliza.
  return { departmentId: department.id, queue: department.name, ...(assigneeId ? { assigneeId } : {}) };
}
