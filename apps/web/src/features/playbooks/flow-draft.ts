import type {AutomationDefinition} from '../../shared/types/api';

// Rascunho local: o Nexo não salva sozinho como o Leona, então o trabalho sobrevive a um fechamento
// acidental. localStorage pode estar bloqueado (janela privada, cota) — toda leitura e escrita falha em silêncio.
export type LocalDraft={version:number;at:number;definition:AutomationDefinition};
export const draftKey=(id:string)=>`nexo-flow-draft:${id}`;
export function readDraft(id:string):LocalDraft|null{
  try{
    const raw=localStorage.getItem(draftKey(id));
    if(!raw)return null;
    const parsed=JSON.parse(raw) as LocalDraft;
    return Array.isArray(parsed?.definition?.nodes)&&typeof parsed?.version==='number'&&typeof parsed?.at==='number'?parsed:null;
  }catch{return null}
}
export function writeDraft(id:string,draft:LocalDraft){try{localStorage.setItem(draftKey(id),JSON.stringify(draft))}catch{/* sem espaço ou sem acesso: o aviso de saída ainda protege */}}
export function clearDraft(id:string){try{localStorage.removeItem(draftKey(id))}catch{/* idem */}}
