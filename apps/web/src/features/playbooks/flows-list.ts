import type {PlaybookStatus} from '../../shared/types/api';

export type StatusFilter='all'|'active'|'paused'|'archived';
const normalize=(value:string)=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();

export function filterFlows<T extends {name:string;status:PlaybookStatus;folderId?:string|null}>(items:T[],{folderId,query,status}:{folderId:string|null;query:string;status:StatusFilter}){
  const needle=normalize(query.trim());
  return items.filter(item=>(item.folderId??null)===folderId&&(status==='all'?item.status!=='ARCHIVED':item.status===({active:'PUBLISHED',paused:'PAUSED',archived:'ARCHIVED'} as const)[status])&&normalize(item.name).includes(needle));
}

export type SortOrder='recent'|'name';
export function sortFlows<T extends {name:string;updatedAt:string}>(items:T[],order:SortOrder){
  return [...items].sort(order==='name'?(a,b)=>a.name.localeCompare(b.name,'pt-BR'):(a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}

export const formatUpdated=(iso:string)=>new Date(iso).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
