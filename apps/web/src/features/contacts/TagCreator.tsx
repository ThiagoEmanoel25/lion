import {useState} from 'react';
import {useToast} from '../../shared/ui/Toast';
import {useCreateContactTag} from './api/queries';

/** Criação de etiqueta (usada no drawer do contato e na tela de contatos). Não usa <form> para poder ficar dentro de outro form. */
export function TagCreator({onCreated,autoFocus=false}:{onCreated:(tag:{id:string;name:string;color:string})=>void;autoFocus?:boolean}){
  const toast=useToast();const create=useCreateContactTag();const [name,setName]=useState('');const [color,setColor]=useState('#17765b');const [error,setError]=useState('');
  async function submit(){
    const value=name.trim();if(!value){setError('Informe o nome da etiqueta.');return}
    if(value.length>40){setError('Use no máximo 40 caracteres.');return}
    setError('');
    try{const tag=await create.mutateAsync({name:value,color});setName('');toast.success(`Etiqueta "${tag.name}" criada.`);onCreated(tag)}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível criar a etiqueta.')}
  }
  return <div className="tag-creator"><div className="tag-creator-row"><input aria-label="Nome da nova etiqueta" placeholder="Nome da nova etiqueta" maxLength={40} value={name} autoFocus={autoFocus} aria-invalid={Boolean(error)} onChange={event=>{setName(event.target.value);setError('')}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void submit()}}}/><input type="color" aria-label="Cor da etiqueta" value={color} onChange={event=>setColor(event.target.value)}/><button type="button" disabled={create.isPending} onClick={()=>void submit()}>{create.isPending?'Criando…':'Criar etiqueta'}</button></div>{error&&<small className="field-error" role="alert">{error}</small>}</div>
}
