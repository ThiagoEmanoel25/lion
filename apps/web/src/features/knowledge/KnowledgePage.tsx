import {useState,type FormEvent} from 'react';
import {ApiError} from '../../shared/api/client';
import {useCreateKnowledgeSource,useDeleteKnowledgeSource,useKnowledgeSources} from './api/queries';
import {ErrorState,LoadingState} from '../../shared/ui/AsyncState';
import {useToast} from '../../shared/ui/Toast';
import '../../shared/ui/page-kit.css';
import '../agents/agents.css';

const STATUS_LABEL={READY:'Pronto',FAILED:'Falhou'} as const;
const statusLabel=(status:string)=>STATUS_LABEL[status as keyof typeof STATUS_LABEL]??'Processando';
const statusTone=(status:string)=>status==='READY'?'on':status==='FAILED'?'bad':'warn';

export function KnowledgePage(){
  const toast=useToast();const sources=useKnowledgeSources(),create=useCreateKnowledgeSource(),remove=useDeleteKnowledgeSource();
  const [adding,setAdding]=useState(false),[name,setName]=useState(''),[kind,setKind]=useState<'text'|'url'>('text'),[content,setContent]=useState(''),[notice,setNotice]=useState('');
  async function submit(event:FormEvent){event.preventDefault();setNotice('');try{await create.mutateAsync({name,kind,...(kind==='url'?{uri:content}:{content})});setName('');setContent('');setAdding(false);toast.success('Fonte adicionada. Ela aparece como pronta quando terminar de processar.')}catch(error){const message=error instanceof ApiError?error.message:'Não foi possível adicionar a fonte.';setNotice(message);toast.error(message)}}
  if(sources.isLoading)return <div className="page ui-page"><LoadingState label="Carregando conhecimento…"/></div>;
  if(sources.isError)return <div className="page ui-page"><ErrorState title="Não foi possível carregar as fontes." error={sources.error} retry={()=>sources.refetch()}/></div>;
  return <div className="page ui-page knowledge-page">
    <header className="ui-head"><div><h1>Conhecimento</h1><p>Fontes isoladas que sustentam respostas seguras.</p></div><div className="ui-head-actions"><button type="button" className="ui-btn primary" onClick={()=>setAdding(value=>!value)}>{adding?'Cancelar':'+ Adicionar fonte'}</button></div></header>
    {adding&&<form className="ui-form" onSubmit={submit}>
      <div className="ui-two"><label className="ui-field">Nome<input required minLength={2} value={name} onChange={e=>setName(e.target.value)}/></label><label className="ui-field">Tipo<select value={kind} onChange={e=>setKind(e.target.value as 'text'|'url')}><option value="text">Texto</option><option value="url">URL</option></select></label></div>
      <label className="ui-field">{kind==='url'?'Endereço da página':'Conteúdo'}{kind==='url'?<input required type="url" value={content} onChange={e=>setContent(e.target.value)}/>:<textarea required rows={7} value={content} onChange={e=>setContent(e.target.value)}/>}</label>
      {notice&&<p className="ui-alert" role="alert">{notice}</p>}
      <div className="ui-actions"><button className="ui-btn primary" disabled={create.isPending}>{create.isPending?'Enviando…':'Indexar fonte'}</button></div>
    </form>}
    {sources.data?.length?<ul className="ui-rows knowledge">{sources.data.map(source=><li className="source-row" key={source.id}>
      <div className="grow"><b>{source.name}</b><small>Atualizado em {new Intl.DateTimeFormat('pt-BR').format(new Date(source.updatedAt))} · {source._count.chunks} trechos</small></div>
      <span className="source-kind">{source.kind==='url'?'Página (URL)':'Texto'}</span>
      <span className={`ui-status ${statusTone(source.status)}`}>{statusLabel(source.status)}</span>
      <div className="ui-row-actions"><button type="button" className="ui-btn danger sm" disabled={remove.isPending} onClick={async()=>{if(confirm(`Excluir a fonte “${source.name}”? Os agentes vinculados deixam de usá-la. Esta ação não pode ser desfeita.`)){try{await remove.mutateAsync(source.id);toast.success('Fonte excluída.')}catch(error){toast.error(error instanceof Error?error.message:'Não foi possível excluir a fonte.')}}}}>Excluir fonte</button></div>
    </li>)}</ul>:<div className="ui-empty"><b>Nenhuma fonte de conhecimento.</b>Adicione um texto ou o endereço de uma página para que seus agentes de IA respondam com base no seu conteúdo.<br/><button type="button" className="ui-btn primary" onClick={()=>setAdding(true)}>Adicionar primeira fonte</button></div>}
    <p className="ui-notice knowledge-note"><b>Isolamento de dados.</b> O conhecimento deste workspace não é compartilhado com outros clientes e credenciais de provedores nunca são retornadas pela API.</p>
  </div>
}
