export type DomainEvent<T=unknown>={
  id:string; workspaceId:string; type:string; aggregate:string; aggregateId:string;
  occurredAt:string; payload:T;
};

export type TenantContext={workspaceId:string;userId:string;role:'OWNER'|'ADMIN'|'SUPERVISOR'|'AGENT'|'VIEWER'};

export class DomainError extends Error {
  constructor(public readonly code:string,message:string,public readonly status=400,public readonly details?:unknown){super(message)}
}

export const permissions={
  OWNER:['*'],
  ADMIN:['workspace.manage','members.manage','channel.manage','conversation.*','contact.*','playbook.*','analytics.read','audit.read','billing.read'],
  SUPERVISOR:['conversation.*','contact.*','playbook.*','analytics.read','knowledge.*'],
  AGENT:['conversation.read','conversation.reply','conversation.assign.self','contact.read','contact.update'],
  VIEWER:['conversation.read','contact.read','analytics.read']
} as const;

export function can(role:keyof typeof permissions,permission:string){
  const allowed=permissions[role] as readonly string[];
  return allowed.includes('*')||allowed.includes(permission)||allowed.some(p=>p.endsWith('.*')&&permission.startsWith(p.slice(0,-1)));
}

export type KanbanMode='create_or_move'|'create_only'|'move_only';
export type KanbanAction='create'|'move'|'noop';

export function kanbanAction(mode:KanbanMode,existingColumnId:string|null,targetColumnId:string):KanbanAction{
  if(existingColumnId===null)return mode==='move_only'?'noop':'create';
  if(mode==='create_only'||existingColumnId===targetColumnId)return 'noop';
  return 'move';
}
