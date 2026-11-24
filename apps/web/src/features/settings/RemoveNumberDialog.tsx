import {useEffect,useRef} from 'react';

const FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export const UNLINK_FAILED_HINT='Se o aparelho continuar listado no celular, remova-o em Configurações > Aparelhos conectados no WhatsApp.';
const asInternational=(phone:string)=>`+${phone.replace(/\D/g,'')}`;

/** Diálogo modal de confirmação de "Remover número": aria-modal, foco preso, Esc cancela e o foco volta ao botão de origem. */
export function RemoveNumberDialog({phone,pending,onCancel,onConfirm}:{phone:string;pending:boolean;onCancel:()=>void;onConfirm:()=>void}){
  const box=useRef<HTMLDivElement>(null);const cancel=useRef(onCancel);cancel.current=onCancel;
  useEffect(()=>{
    const origin=document.activeElement as HTMLElement|null;const node=box.current;
    const items=()=>Array.from(node?.querySelectorAll<HTMLElement>(FOCUSABLE)??[]);
    (node?.querySelector<HTMLElement>('[data-autofocus]')??items()[0]??node)?.focus();
    function onKey(event:KeyboardEvent){
      if(event.key==='Escape'){event.stopPropagation();cancel.current();return}
      if(event.key!=='Tab')return;
      const list=items();if(!list.length){event.preventDefault();return}
      const first=list[0]!,last=list[list.length-1]!;
      if(event.shiftKey&&(document.activeElement===first||!node?.contains(document.activeElement))){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&(document.activeElement===last||!node?.contains(document.activeElement))){event.preventDefault();first.focus()}
    }
    document.addEventListener('keydown',onKey,true);
    return()=>{document.removeEventListener('keydown',onKey,true);origin?.focus?.()};
  },[]);
  return <div className="remove-number-backdrop ui-dialog-backdrop" role="presentation" onMouseDown={event=>{if(event.currentTarget===event.target&&!pending)onCancel()}}>
    <div className="remove-number-dialog ui-dialog" role="alertdialog" aria-modal="true" aria-labelledby="remove-number-title" aria-describedby="remove-number-text" ref={box} tabIndex={-1}>
      <h2 id="remove-number-title">Remover número</h2>
      <p id="remove-number-text">Remover o número {asInternational(phone)}? O aparelho será desvinculado do WhatsApp, as credenciais serão apagadas e o canal deixará de contar no seu plano. O histórico de conversas continua disponível. Esta ação não pode ser desfeita.</p>
      <div className="remove-number-actions ui-dialog-actions">
        <button type="button" className="ui-btn" data-autofocus disabled={pending} onClick={onCancel}>Cancelar</button>
        <button type="button" className="ui-btn remove-number-confirm" disabled={pending} onClick={onConfirm}>{pending?'Removendo…':'Remover número'}</button>
      </div>
    </div>
  </div>
}
