import type {ReactNode} from 'react';
export function LoadingState(){return <div className="async-state"><i/><span>Carregando dados da operação…</span></div>}
export function ErrorState({error,retry}:{error:unknown;retry?:()=>void}){return <div className="async-state error"><b>Não foi possível carregar.</b><span>{error instanceof Error?error.message:'Tente novamente.'}</span>{retry&&<button onClick={retry}>Tentar novamente</button>}</div>}
export function EmptyState({title,children}:{title:string;children?:ReactNode}){return <div className="async-state empty"><b>{title}</b>{children&&<span>{children}</span>}</div>}
