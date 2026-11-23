import {useState} from 'react';
import {EmptyState,ErrorState,LoadingState} from '../../shared/ui/AsyncState';
import {useToast} from '../../shared/ui/Toast';
import {useContactMeta,useContacts} from './api/queries';
import {ContactDrawer} from './ContactDrawer';
import {ImportDialog} from './ImportDialog';
import {TagCreator} from './TagCreator';
import {stageLabel,stages,formatPhone,sourceLabel} from './labels';
import {consentStatus} from './consent-view';
import type {ContactRow} from './types';
import './contacts.css';

const consentBadge:Record<string,string>={given:'Consentido',revoked:'Revogado',optout:'Pediu para sair',none:'Sem consentimento'};

export function ContactsPage(){
  const toast=useToast();
  const [search,setSearch]=useState('');const [stage,setStage]=useState('');const [ownerId,setOwnerId]=useState('');const [tagId,setTagId]=useState('');
  const [editor,setEditor]=useState<ContactRow|null|undefined>(undefined);const [importOpen,setImportOpen]=useState(false);const [tagOpen,setTagOpen]=useState(false);
  const contacts=useContacts({search,stage,ownerId,tagId});const meta=useContactMeta();
  const count=(id:string)=>meta.data?.stageCounts.find(item=>item.stage===id)?.count??0;
  const clear=()=>{setSearch('');setStage('');setOwnerId('');setTagId('')};
  const filtered=Boolean(search||stage||ownerId||tagId);
  return <div className="page contacts-page">
    <div className="heading"><div><small>RELACIONAMENTO</small><h1>Contatos</h1><p>Organize leads, responsáveis, etiquetas e dados do seu CRM.</p></div><div className="contact-actions"><button onClick={()=>setImportOpen(true)}>Importar CSV</button><button aria-expanded={tagOpen} onClick={()=>setTagOpen(value=>!value)}>Nova etiqueta</button><button className="primary" onClick={()=>setEditor(null)}>Novo contato</button></div></div>
    {tagOpen&&<section className="panel tag-panel" aria-label="Nova etiqueta"><TagCreator autoFocus onCreated={()=>setTagOpen(false)}/></section>}
    <div className="stage-cards">{stages.map(([id,label])=><article key={id} className={stage===id?'selected':''} onClick={()=>setStage(stage===id?'':id)}><span>{label}</span><b>{count(id)}</b><small>{stage===id?'Filtro ativo':'Clique para filtrar'}</small></article>)}</div>
    <section className="panel contact-filters"><input aria-label="Buscar contatos" placeholder="Buscar por nome, telefone ou e-mail" value={search} onChange={event=>setSearch(event.target.value)}/><select aria-label="Responsável" value={ownerId} onChange={event=>setOwnerId(event.target.value)}><option value="">Todos os responsáveis</option>{meta.data?.members.map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select><select aria-label="Etiqueta" value={tagId} onChange={event=>setTagId(event.target.value)}><option value="">Todas as etiquetas</option>{meta.data?.tags.map(tag=><option key={tag.id} value={tag.id}>{tag.name}</option>)}</select>{filtered&&<button onClick={clear}>Limpar filtros</button>}</section>
    {contacts.isLoading?<LoadingState/>:contacts.isError?<ErrorState error={contacts.error} retry={()=>contacts.refetch()}/>:contacts.data?.items.length===0?filtered?<EmptyState title="Nenhum contato com esses filtros" actionLabel="Limpar filtros" onAction={clear}>Tente outra busca ou remova algum filtro.</EmptyState>:<EmptyState title="Você ainda não tem contatos" action={<div className="contact-actions"><button className="async-action" onClick={()=>setImportOpen(true)}>Importar CSV</button><button className="async-action primary" onClick={()=>setEditor(null)}>Novo contato</button></div>}>Importe uma planilha CSV ou cadastre o primeiro contato para começar a organizar seus leads.</EmptyState>:
      <section className="panel table contact-table"><table><thead><tr><th>CONTATO</th><th>ORIGEM</th><th>ETAPA</th><th>CONSENTIMENTO</th><th>ETIQUETAS</th><th>RESPONSÁVEL</th><th/></tr></thead><tbody>{contacts.data?.items.map(contact=>{const tone=consentStatus(contact.consent).tone;return <tr key={contact.id}><td><b>{contact.name||'Sem nome'}</b><small>{formatPhone(contact.phone)}{contact.email?` · ${contact.email}`:''}</small></td><td>{sourceLabel(contact.source)}</td><td><em>{stageLabel(contact.stage)}</em></td><td><span className={`consent-badge tone-${tone}`}>{consentBadge[tone]}</span></td><td><div className="contact-tags">{contact.tags.length?contact.tags.map(item=><i key={item.tag.id} style={{borderColor:item.tag.color}}>{item.tag.name}</i>):'—'}</div></td><td>{contact.owner?.name||'Não atribuído'}</td><td><button aria-label={`Editar ${contact.name??contact.phone}`} onClick={()=>setEditor(contact)}>Editar</button></td></tr>})}</tbody></table></section>}
    {editor!==undefined&&<ContactDrawer key={editor?.id??'new'} contact={editor} meta={meta.data} onClose={()=>setEditor(undefined)}/>}
    {importOpen&&<ImportDialog close={()=>setImportOpen(false)} onDone={(created,updated)=>toast.success(`Importação concluída: ${created} criados, ${updated} atualizados.`)}/>}
  </div>
}
