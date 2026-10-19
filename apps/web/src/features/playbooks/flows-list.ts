import type {PlaybookStatus} from '../../shared/types/api';

export type StatusFilter='all'|'active'|'paused';
const normalize=(value:string)=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();

export function filterFlows<T extends {name:string;status:PlaybookStatus;folderId?:string|null}>(items:T[],{folderId,query,status}:{folderId:string|null;query:string;status:StatusFilter}){
  const needle=normalize(query.trim());
  return items.filter(item=>(item.folderId??null)===folderId&&(status==='all'||item.status===(status==='active'?'PUBLISHED':'PAUSED'))&&normalize(item.name).includes(needle));
}

export const formatUpdated=(iso:string)=>new Date(iso).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
