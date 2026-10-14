import {useState,type FormEvent} from 'react';
import {Link,useNavigate} from 'react-router-dom';
import {ApiError} from '../../shared/api/client';
import {useCreatePlaybook,usePlaybooks} from './api/queries';
import './flow-builder.css';

const templates=[
  {id:'qualification' as const,icon:'✦',label:'Qualificação',description:'Recebe, qualifica e encaminha oportunidades.'},
  {id:'reactivation' as const,icon:'↻',label:'Reativação',description:'Retoma contatos inativos no momento certo.'},
  {id:'support' as const,icon:'◎',label:'Atendimento',description:'Responde dúvidas e transfere exceções.'}
];

export function PlaybooksPage(){
  const playbooks=usePlaybooks();const create=useCreatePlaybook();const navigate=useNavigate();
  const [creating,setCreating]=useState(false);const [name,setName]=useState('');const [template,setTemplate]=useState<(typeof templates)[number]['id']>('qualification');
  async function submit(event:FormEvent){event.preventDefault();if(!name.trim())return;const created=await create.mutateAsync({name:name.trim(),template});setCreating(false);setName('');navigate(`/playbooks/${created.id}/editor`)}
  return <div className="page playbooks-page">
    <div className="heading"><div><small>AUTOMAÇÃO</small><h1>Fluxos</h1><p>Crie jornadas visuais, teste cada caminho e publique com segurança.</p></div><button className="primary" onClick={()=>setCreating(true)}>+ Novo fluxo</button></div>
    {creating&&<form className="create-flow-panel" onSubmit={submit}>
      <div><small>NOVO FLUXO</small><h2>Comece com uma estrutura pronta</h2></div>
      <label>Nome<input autoFocus value={name} onChange={event=>setName(event.target.value)} placeholder="Ex.: Qualificação comercial" /></label>
      <div className="template-options">{templates.map(item=><button type="button" key={item.id} className={template===item.id?'selected':''} onClick={()=>setTemplate(item.id)}><span>{item.icon}</span><b>{item.label}</b><small>{item.description}</small></button>)}</div>
      {create.error&&<p className="form-error">{create.error instanceof ApiError?create.error.message:'Não foi possível criar o fluxo.'}</p>}
      <footer><button type="button" onClick={()=>setCreating(false)}>Cancelar</button><button className="primary" disabled={create.isPending||!name.trim()}>{create.isPending?'Criando…':'Criar fluxo'}</button></footer>
    </form>}
    {playbooks.isLoading&&<div className="flow-empty">Carregando fluxos…</div>}
    {playbooks.isError&&<div className="flow-empty error">Não foi possível carregar os fluxos. <button onClick={()=>playbooks.refetch()}>Tentar novamente</button></div>}
    {!playbooks.isLoading&&!playbooks.isError&&!playbooks.data?.length&&<div className="flow-empty"><span>◇</span><h2>Seu primeiro fluxo começa aqui</h2><p>Escolha um modelo e personalize os passos no editor visual.</p><button className="primary" onClick={()=>setCreating(true)}>Criar fluxo</button></div>}
    <div className="cards flow-cards">{playbooks.data?.map((item,index)=><article key={item.id}>
      <header><span>{templates[index%templates.length].icon}</span><em className={item.status==='PUBLISHED'?'published':'draft'}>{item.status==='PUBLISHED'?'PUBLICADO':'RASCUNHO'}</em></header>
      <h2>{item.name}</h2><p>{item.description||'Automação pronta para ser configurada no editor visual.'}</p>
      <div className="flow-card-preview"><i>Gatilho</i><u /><i>Decisão</i><u /><i>Resultado</i></div>
      <footer><span><b>{item._count?.versions??1}</b> versões</span><span>Atualizado {new Date(item.updatedAt).toLocaleDateString('pt-BR')}</span></footer>
      <Link className="flow-edit-link" to={`/playbooks/${item.id}/editor`}>Editar e testar <span>→</span></Link>
    </article>)}</div>
  </div>
}
