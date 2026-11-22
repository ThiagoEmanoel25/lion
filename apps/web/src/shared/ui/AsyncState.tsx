import type {ReactNode} from 'react';
import {Inbox,TriangleAlert} from 'lucide-react';

/** Skeleton de carregamento. `label` e `lines` são opcionais. */
export function LoadingState({label='Carregando dados da operação…',lines=3}:{label?:string;lines?:number}){
  return <div className="async-state loading" role="status" aria-live="polite" aria-busy="true">
    <div className="skeleton-stack" aria-hidden="true">{Array.from({length:Math.max(1,lines)},(_,index)=><i className="skeleton" key={index} style={{width:`${index===0?62:index%2?100:84}%`}}/>)}</div>
    <span className="async-label">{label}</span>
  </div>
}

const technical=/failed to fetch|networkerror|load failed|typeerror|^http\s?\d|status code|unexpected token|<html|econn/i;
function humanMessage(error:unknown){
  const raw=error instanceof Error?error.message.trim():'';
  if(!raw)return 'Algo deu errado do nosso lado. Tente novamente em instantes.';
  if(/failed to fetch|networkerror|load failed|econn/i.test(raw))return 'Parece que a conexão caiu. Verifique sua internet e tente novamente.';
  if(technical.test(raw)||raw.length>180)return 'Algo deu errado do nosso lado. Tente novamente em instantes.';
  return raw;
}

/** Erro amigável. `title` e `retryLabel` são opcionais. */
export function ErrorState({error,retry,title='Não foi possível carregar.',retryLabel='Tentar novamente'}:{error:unknown;retry?:()=>void;title?:string;retryLabel?:string}){
  return <div className="async-state error" role="alert">
    <span className="async-icon" aria-hidden="true"><TriangleAlert size={22}/></span>
    <b>{title}</b>
    <span>{humanMessage(error)}</span>
    {retry&&<button type="button" className="async-action" onClick={retry}>{retryLabel}</button>}
  </div>
}

/**
 * Estado vazio. `icon` (padrão: caixa de entrada), `action` (nó livre, ex.: <button>/<Link>)
 * ou o atalho `actionLabel` + `onAction` renderizam um CTA opcional.
 */
export function EmptyState({title,children,icon,action,actionLabel,onAction}:{title:string;children?:ReactNode;icon?:ReactNode;action?:ReactNode;actionLabel?:string;onAction?:()=>void}){
  return <div className="async-state empty">
    <span className="async-icon" aria-hidden="true">{icon??<Inbox size={22}/>}</span>
    <b>{title}</b>
    {children&&<span>{children}</span>}
    {action??(actionLabel&&onAction&&<button type="button" className="async-action primary" onClick={onAction}>{actionLabel}</button>)}
  </div>
}
