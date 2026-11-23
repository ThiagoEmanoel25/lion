import {useEffect,useId,useRef,useState,type FormEvent,type KeyboardEvent,type ReactNode} from 'react';

const FOCUSABLE='button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[href],[tabindex]:not([tabindex="-1"])';
type BaseProps={title:string;confirmLabel?:string;cancelLabel?:string;danger?:boolean;busy?:boolean;error?:string;onConfirm:()=>void;onCancel:()=>void;children?:ReactNode;confirmDisabled?:boolean};

/** Modal acessível local: aria-modal, foco preso, Esc cancela, devolve o foco a quem abriu. */
export function FlowDialog({title,confirmLabel='Confirmar',cancelLabel='Cancelar',danger,busy,error,onConfirm,onCancel,children,confirmDisabled}:BaseProps){
  const ref=useRef<HTMLElement>(null);const titleId=useId();
  useEffect(()=>{
    const opener=document.activeElement as HTMLElement|null;
    const first=ref.current?.querySelector<HTMLElement>('input,select,textarea')??ref.current?.querySelector<HTMLElement>('button.primary');
    first?.focus();
    return ()=>{if(opener&&document.contains(opener))opener.focus()};
  },[]);
  function keyDown(event:KeyboardEvent){
    if(event.key==='Escape'){event.stopPropagation();onCancel();return}
    if(event.key!=='Tab'||!ref.current)return;
    const items=[...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];if(!items.length)return;
    const first=items[0]!;const last=items[items.length-1]!;
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  }
  function submit(event:FormEvent){event.preventDefault();if(!busy&&!confirmDisabled)onConfirm()}
  return <div className="flow-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onCancel()}}>
    <section ref={ref} className="flow-import-dialog flow-small-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={keyDown}>
      <form onSubmit={submit}>
        <h2 id={titleId}>{title}</h2>
        {children}
        {error&&<p className="form-error" role="alert">{error}</p>}
        <footer><button type="button" onClick={onCancel}>{cancelLabel}</button><button type="submit" className={danger?'primary danger-action':'primary'} disabled={busy||confirmDisabled}>{busy?'Aguarde…':confirmLabel}</button></footer>
      </form>
    </section>
  </div>;
}

export function PromptDialog({title,label,initial='',placeholder,confirmLabel,error,busy,onConfirm,onCancel}:{title:string;label:string;initial?:string;placeholder?:string;confirmLabel?:string;error?:string;busy?:boolean;onConfirm:(value:string)=>void;onCancel:()=>void}){
  const [value,setValue]=useState(initial);
  return <FlowDialog title={title} confirmLabel={confirmLabel} error={error} busy={busy} confirmDisabled={!value.trim()} onConfirm={()=>onConfirm(value.trim())} onCancel={onCancel}>
    <label>{label}<input value={value} maxLength={80} placeholder={placeholder} onChange={event=>setValue(event.target.value)}/></label>
  </FlowDialog>;
}

export function ConfirmDialog({title,message,confirmLabel,danger,busy,onConfirm,onCancel}:{title:string;message:ReactNode;confirmLabel?:string;danger?:boolean;busy?:boolean;onConfirm:()=>void;onCancel:()=>void}){
  return <FlowDialog title={title} confirmLabel={confirmLabel} danger={danger} busy={busy} onConfirm={onConfirm} onCancel={onCancel}><p>{message}</p></FlowDialog>;
}
