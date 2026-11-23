import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {ContactMeta} from '../../shared/types/api';
import {ApiError} from '../../shared/api/client';
import {useToast} from '../../shared/ui/Toast';
import {useCreateContact,useUpdateContact} from './api/queries';
import {buildContactPayload,consentSources,fieldErrorsFrom,fieldLabel,formFromContact,validateContactForm,type ContactFormState} from './contact-form';
import {consentStatus} from './consent-view';
import {stages} from './labels';
import {TagCreator} from './TagCreator';
import type {ContactRow} from './types';

type Props={contact:ContactRow|null;meta?:ContactMeta;onClose:()=>void};
const knownFields=['name','phone','email','source','stage','ownerId','tagIds','customFields','consent'];

export function ContactDrawer({contact,meta,onClose}:Props){
  const toast=useToast();const createContact=useCreateContact();const updateContact=useUpdateContact();
  const [form,setForm]=useState<ContactFormState>(()=>formFromContact(contact));
  const [errors,setErrors]=useState<Record<string,string>>({});const [formError,setFormError]=useState('');const [focusTick,setFocusTick]=useState(0);
  const formRef=useRef<HTMLFormElement>(null);const pending=createContact.isPending||updateContact.isPending;
  const current=contact?.consent;const optedOut=Boolean(current?.optedOut);const alreadyGiven=Boolean(current?.given)&&!optedOut;
  const set=<K extends keyof ContactFormState>(key:K,value:ContactFormState[K])=>{setForm(state=>({...state,[key]:value}));setErrors(state=>{if(!state[key])return state;const rest={...state};delete rest[key];return rest})};
  // Foco no primeiro campo com erro (acessibilidade).
  useEffect(()=>{if(!focusTick)return;formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()},[focusTick]);
  useEffect(()=>{const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};window.addEventListener('keydown',onKey);return ()=>window.removeEventListener('keydown',onKey)},[onClose]);

  function fail(next:Record<string,string>,general=''){setErrors(next);setFormError(general);setFocusTick(value=>value+1)}
  async function save(event:FormEvent){
    event.preventDefault();setFormError('');
    const local=validateContactForm(form);if(Object.keys(local).length){fail(local);return}
    const payload=buildContactPayload(form,contact);
    try{
      if(contact)await updateContact.mutateAsync({id:contact.id,input:payload});else await createContact.mutateAsync({...payload,phone:form.phone.trim()});
      toast.success(contact?'Contato atualizado.':'Contato criado.');onClose();
    }catch(error){
      if(error instanceof ApiError){
        if(error.code==='VALIDATION_ERROR'){const fields=fieldErrorsFrom(error.details);const known=Object.fromEntries(Object.entries(fields).filter(([key])=>knownFields.includes(key)));const rest=Object.entries(fields).filter(([key])=>!knownFields.includes(key)).map(([key,message])=>`${fieldLabel(key)}: ${message}`);fail(known,Object.keys(fields).length?rest.join(' '):'Confira os campos do contato e tente novamente.');return}
        if(error.code==='CONTACT_EXISTS'){fail({phone:error.message});return}
        if(error.code==='CONTACT_OPTED_OUT'){fail({consent:error.message});return}
      }
      const message=error instanceof Error?error.message:'Não foi possível salvar o contato.';setFormError(message);toast.error(message);
    }
  }
  const fieldProps=(name:string)=>({id:`contact-${name}`,'aria-invalid':Boolean(errors[name])||undefined,'aria-describedby':errors[name]?`contact-${name}-error`:undefined});
  const err=(name:string)=>errors[name]?<small className="field-error" id={`contact-${name}-error`} role="alert">{errors[name]}</small>:null;
  const status=contact?consentStatus(current):null;
  const showSource=optedOut?form.reconsent:form.consentGiven;
  return <div className="contact-overlay" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><section className="contact-drawer" role="dialog" aria-modal="true" aria-label={contact?'Editar contato':'Novo contato'}>
    <header><div><small>{contact?'EDITAR CONTATO':'NOVO CONTATO'}</small><h2>{contact?.name||'Dados do contato'}</h2></div><button type="button" aria-label="Fechar" onClick={onClose}>×</button></header>
    <form ref={formRef} onSubmit={event=>void save(event)} noValidate>
      <div className="field"><label htmlFor="contact-name">Nome</label><input {...fieldProps('name')} name="name" autoComplete="off" value={form.name} onChange={event=>set('name',event.target.value)}/>{err('name')}</div>
      <div className="field"><label htmlFor="contact-phone">Telefone</label><input {...fieldProps('phone')} name="phone" inputMode="tel" autoComplete="off" placeholder="+55 71 99999-9999" value={form.phone} onChange={event=>set('phone',event.target.value)}/>{err('phone')}</div>
      <div className="field"><label htmlFor="contact-email">E-mail</label><input {...fieldProps('email')} name="email" type="email" autoComplete="off" value={form.email} onChange={event=>set('email',event.target.value)}/>{err('email')}</div>
      <div className="field"><label htmlFor="contact-source">Origem</label><input {...fieldProps('source')} name="source" autoComplete="off" value={form.source} onChange={event=>set('source',event.target.value)}/>{err('source')}</div>
      <div className="field"><label htmlFor="contact-stage">Etapa</label><select {...fieldProps('stage')} name="stage" value={form.stage} onChange={event=>set('stage',event.target.value)}>{!stages.some(([id])=>id===form.stage)&&<option value={form.stage}>{form.stage}</option>}{stages.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>{err('stage')}</div>
      <div className="field"><label htmlFor="contact-ownerId">Responsável</label><select {...fieldProps('ownerId')} name="ownerId" value={form.ownerId} onChange={event=>set('ownerId',event.target.value)}><option value="">Não atribuído</option>{meta?.members.map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select>{err('ownerId')}</div>

      <fieldset className="full"><legend>Etiquetas</legend>
        <div className="tag-options">{meta?.tags.length?meta.tags.map(tag=><label key={tag.id}><input type="checkbox" checked={form.tagIds.includes(tag.id)} onChange={()=>set('tagIds',form.tagIds.includes(tag.id)?form.tagIds.filter(item=>item!==tag.id):[...form.tagIds,tag.id])}/>{tag.name}</label>):<small>Nenhuma etiqueta cadastrada. Crie a primeira abaixo.</small>}</div>
        <TagCreator onCreated={tag=>setForm(state=>({...state,tagIds:[...state.tagIds,tag.id]}))}/>
        {err('tagIds')}
      </fieldset>

      <fieldset className="full custom-fields"><legend>Campos personalizados</legend>
        {form.customFields.length===0&&<small>Nenhum campo. Use para guardar dados extras do contato, como cidade ou plano.</small>}
        {form.customFields.map((pair,index)=><div className="custom-field-row" key={index}><input aria-label={`Nome do campo ${index+1}`} placeholder="Nome (ex.: cidade)" value={pair.key} onChange={event=>set('customFields',form.customFields.map((item,position)=>position===index?{...item,key:event.target.value}:item))}/><input aria-label={`Valor do campo ${index+1}`} placeholder="Valor" value={pair.value} onChange={event=>set('customFields',form.customFields.map((item,position)=>position===index?{...item,value:event.target.value}:item))}/><button type="button" aria-label={`Remover campo ${index+1}`} onClick={()=>set('customFields',form.customFields.filter((_,position)=>position!==index))}>×</button></div>)}
        <button type="button" className="add-field" onClick={()=>set('customFields',[...form.customFields,{key:'',value:''}])}>＋ Adicionar campo</button>
        {errors.customFields&&<small className="field-error" role="alert" id="contact-customFields-error">{errors.customFields}</small>}
      </fieldset>

      <fieldset className="full consent-box"><legend>Consentimento (disparos)</legend>
        {status&&<p className={`consent-status tone-${status.tone}`}>{status.text}</p>}
        {optedOut?<>
          <p className="consent-warning" role="note"><b>Atenção:</b> este contato pediu para sair da lista (SAIR/PARAR) e não recebe disparos. Só reative se ele próprio pediu para voltar a receber mensagens e você consegue comprovar isso.</p>
          <label className="check-row"><input type="checkbox" {...fieldProps('consent')} checked={form.reconsent} onChange={event=>set('reconsent',event.target.checked)}/>Confirmo que o contato autorizou novamente (reativar consentimento)</label>
        </>:<label className="check-row"><input type="checkbox" checked={form.consentGiven} onChange={event=>set('consentGiven',event.target.checked)}/>Consentimento para receber mensagens (disparos)</label>}
        {showSource&&<div className="field consent-source"><label htmlFor="contact-consent-source">Origem do consentimento</label><select id="contact-consent-source" value={form.consentSource} disabled={alreadyGiven} onChange={event=>set('consentSource',event.target.value)}>{!consentSources.some(([id])=>id===form.consentSource)&&<option value={form.consentSource}>{form.consentSource}</option>}{consentSources.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></div>}
        {!showSource&&!optedOut&&<small>Sem consentimento, o contato não é incluído em disparos.</small>}
        {err('consent')}
      </fieldset>

      {formError&&<p className="form-error" role="alert">{formError}</p>}
      <footer><button type="button" onClick={onClose}>Cancelar</button><button className="primary" disabled={pending}>{pending?'Salvando…':'Salvar contato'}</button></footer>
    </form></section></div>
}
