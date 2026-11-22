import {createContext,useCallback,useContext,useMemo,useRef,useState,type ReactNode} from 'react';
import {CircleAlert,CircleCheck,X} from 'lucide-react';

type ToastKind='success'|'error';
type ToastItem={id:number;kind:ToastKind;message:string};
type ToastApi={success:(message:string)=>void;error:(message:string)=>void};
const ToastContext=createContext<ToastApi|null>(null);

/** Uso: const toast=useToast(); toast.success('Salvo!'); toast.error('Falhou.'). Provider montado em Layout. */
export function useToast():ToastApi{
  const api=useContext(ToastContext);
  return api??{success:()=>undefined,error:()=>undefined};
}

export function ToastProvider({children}:{children:ReactNode}){
  const [items,setItems]=useState<ToastItem[]>([]);
  const next=useRef(0);
  const dismiss=useCallback((id:number)=>setItems(list=>list.filter(item=>item.id!==id)),[]);
  const push=useCallback((kind:ToastKind,message:string)=>{
    const id=++next.current;
    setItems(list=>[...list.slice(-3),{id,kind,message}]);
    window.setTimeout(()=>dismiss(id),kind==='error'?8000:4500);
  },[dismiss]);
  const api=useMemo<ToastApi>(()=>({success:message=>push('success',message),error:message=>push('error',message)}),[push]);
  return <ToastContext.Provider value={api}>
    {children}
    <div className="toast-region" aria-live="polite" aria-atomic="false">
      {items.map(item=><div key={item.id} className={`toast ${item.kind}`} role={item.kind==='error'?'alert':'status'}>
        {item.kind==='error'?<CircleAlert size={18} aria-hidden="true"/>:<CircleCheck size={18} aria-hidden="true"/>}
        <span>{item.message}</span>
        <button type="button" aria-label="Dispensar notificação" onClick={()=>dismiss(item.id)}><X size={16} aria-hidden="true"/></button>
      </div>)}
    </div>
  </ToastContext.Provider>
}
