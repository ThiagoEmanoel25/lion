import {useEffect,useRef,type ReactNode} from 'react';

const FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Diálogo modal local do Kanban: aria-modal, foco preso, Esc fecha e o foco volta ao elemento de origem. */
export function Dialog({title,onClose,children,labelId='kanban-dialog-title'}:{title:string;onClose:()=>void;children:ReactNode;labelId?:string}){
  const box=useRef<HTMLDivElement>(null);const close=useRef(onClose);close.current=onClose;
  useEffect(()=>{
    const origin=document.activeElement as HTMLElement|null;const node=box.current;
    const items=()=>Array.from(node?.querySelectorAll<HTMLElement>(FOCUSABLE)??[]).filter(item=>item.offsetParent!==null||item===document.activeElement);
    (node?.querySelector<HTMLElement>('[data-autofocus]')??items()[0]??node)?.focus();
    function onKey(event:KeyboardEvent){
      if(event.key==='Escape'){event.stopPropagation();close.current();return}
      if(event.key!=='Tab')return;
      const list=items();if(!list.length){event.preventDefault();return}
      const first=list[0]!,last=list[list.length-1]!;
      if(event.shiftKey&&(document.activeElement===first||!node?.contains(document.activeElement))){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&(document.activeElement===last||!node?.contains(document.activeElement))){event.preventDefault();first.focus()}
    }
    document.addEventListener('keydown',onKey,true);
    return()=>{document.removeEventListener('keydown',onKey,true);origin?.focus?.()};
  },[]);
  return <div className="kanban-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.currentTarget===event.target)onClose()}}>
    <div className="kanban-modal" role="dialog" aria-modal="true" aria-labelledby={labelId} ref={box} tabIndex={-1}><h2 id={labelId}>{title}</h2>{children}</div>
  </div>
}
