import {useEffect,useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import {Pause,Play,X} from 'lucide-react';
import {EmptyState,ErrorState,LoadingState} from '../../shared/ui/AsyncState';
import {useToast} from '../../shared/ui/Toast';
import {useBroadcastAction,useBroadcastDependencies,useBroadcastPreview,useBroadcasts,useCreateBroadcast,type BroadcastAudience,type BroadcastInput} from './api/queries';
import {describeApiError} from '../settings/errors';
import {buildAudiencePayload,canCreateBroadcast,hasAudienceFilter,progressPercent,progressSummary} from './audience';
import './broadcasts.css';

const STATUS={DRAFT:'Rascunho',RUNNING:'Enviando',PAUSED:'Pausado',DONE:'Concluído',CANCELLED:'Cancelado'} as const;
const localNow=()=>{const date=new Date(Date.now()+5*60_000);return new Date(date.getTime()-date.getTimezoneOffset()*60_000).toISOString().slice(0,16)};
const emptyAudience:BroadcastAudience={tagIds:[],stages:[],contactIds:[]};
const formatDate=(value:string)=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value));

export function BroadcastsPage(){
  const list=useBroadcasts(),dependencies=useBroadcastDependencies();
  const create=useCreateBroadcast(),action=useBroadcastAction(),preview=useBroadcastPreview();
  const toast=useToast();
  const [open,setOpen]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [form,setForm]=useState<BroadcastInput>({name:'',channelId:'',body:'',startAt:localNow(),minIntervalSeconds:45,maxIntervalSeconds:180,dailyQuota:200,audience:emptyAudience});
  const connected=useMemo(()=>(dependencies.data?.channels??[]).filter(channel=>channel.status==='CONNECTED'),[dependencies.data]);
  const stages=useMemo(()=>(dependencies.data?.stages??[]).filter(item=>item.count>0),[dependencies.data]);
  const [allContacts,setAllContacts]=useState(false),[confirmedAll,setConfirmedAll]=useState(false);
  const audienceKey=JSON.stringify(form.audience);
  // A prévia roda sozinha a cada mudança de público: quem dispara precisa ver o alcance antes, não depois.
  useEffect(()=>{if(open)preview.mutate(JSON.parse(audienceKey) as BroadcastAudience)},[open,audienceKey]);
  const filtered=hasAudienceFilter(form.audience);
  function changeAudience(audience:BroadcastAudience){setForm(current=>({...current,audience}));setAllContacts(false);setConfirmedAll(false)}

  function toggle(list:string[],value:string){return list.includes(value)?list.filter(item=>item!==value):[...list,value]}
  async function submit(){
    setError(null);
    try{
      await create.mutateAsync({...form,audience:buildAudiencePayload(form.audience,allContacts&&confirmedAll),startAt:new Date(form.startAt).toISOString()});
      setOpen(false);setAllContacts(false);setConfirmedAll(false);setForm(current=>({...current,name:'',body:'',audience:emptyAudience}));toast.success('Disparo criado como rascunho. Clique em Começar quando estiver pronto.');
    }catch(failure){const message=describeApiError(failure,'Não foi possível criar o disparo.');setError(message);toast.error(message)}
  }

  if(list.isLoading)return <div className="page"><LoadingState/></div>;
  if(list.isError)return <div className="page"><ErrorState title="Não foi possível carregar os disparos." error={list.error} retry={()=>list.refetch()}/></div>;
  const run=(id:string,kind:'start'|'pause'|'cancel',done:string)=>action.mutate({id,action:kind},{onSuccess:()=>toast.success(done),onError:error=>toast.error(describeApiError(error,'Não foi possível concluir a ação.'))});
  const eligible=preview.data?.eligible??0;
  return <div className="page">
    <div className="heading"><div><small>OPERAÇÕES</small><h1>Disparos em massa</h1><p>Envio para a base com intervalo aleatório e cota diária, porque o WhatsApp bloqueia número que envia em rajada.</p></div><div style={{display:'flex',gap:8}}><button className="primary" onClick={()=>setOpen(true)} disabled={!connected.length} title={connected.length?undefined:'Conecte um número para criar disparos'}>＋ Novo disparo</button></div></div>
    {!connected.length&&<div className="broadcast-warning">Nenhum número conectado. Conecte um número em <Link to="/connections">Conexões</Link> antes de criar um disparo.</div>}

    {open&&<section className="panel broadcast-form">
      <header><div><h2>Novo disparo</h2><p>Só entram contatos com consentimento registrado que não pediram para sair.</p></div><button onClick={()=>setOpen(false)} aria-label="Fechar"><X size={16}/></button></header>
      <div className="broadcast-fields">
        <label>Nome<input value={form.name} maxLength={120} onChange={event=>setForm({...form,name:event.target.value})} placeholder="Ex.: Promoção de outubro"/></label>
        <label>Conexão<select value={form.channelId} onChange={event=>setForm({...form,channelId:event.target.value})}><option value="">Escolha a conexão</option>{connected.map(channel=><option key={channel.id} value={channel.id}>{channel.displayName}</option>)}</select></label>
        <label className="wide">Mensagem<textarea rows={4} value={form.body} maxLength={4096} onChange={event=>setForm({...form,body:event.target.value})} placeholder="Use {{contact.name}} para personalizar."/></label>
        <label>Início<input type="datetime-local" value={form.startAt} onChange={event=>setForm({...form,startAt:event.target.value})}/></label>
        <label>Cota por dia<input type="number" min={1} max={1000} value={form.dailyQuota} onChange={event=>setForm({...form,dailyQuota:Number(event.target.value)})}/></label>
        <label>Intervalo mínimo (s)<input type="number" min={20} max={3600} value={form.minIntervalSeconds} onChange={event=>setForm({...form,minIntervalSeconds:Number(event.target.value)})}/></label>
        <label>Intervalo máximo (s)<input type="number" min={20} max={3600} value={form.maxIntervalSeconds} onChange={event=>setForm({...form,maxIntervalSeconds:Number(event.target.value)})}/></label>
      </div>
      <div className="broadcast-audience">
        <b>Público</b>
        <div className="broadcast-chips">{(dependencies.data?.tags??[]).map(tag=><button key={tag.id} type="button" className={form.audience.tagIds.includes(tag.id)?'on':''} onClick={()=>changeAudience({...form.audience,tagIds:toggle(form.audience.tagIds,tag.id)})}>{tag.name}</button>)}</div>
        <div className="broadcast-chips">{stages.map(item=><button key={item.stage} type="button" className={form.audience.stages.includes(item.stage)?'on':''} onClick={()=>changeAudience({...form.audience,stages:toggle(form.audience.stages,item.stage)})}>{item.stage} <small>{item.count}</small></button>)}</div>
        <p className="broadcast-reach" aria-live="polite">{preview.isPending?'Calculando alcance…':preview.data
          ?<>Alcança <b>{eligible}</b> de {preview.data.matched} contatos encontrados. Ficam de fora <b>sem consentimento: {preview.data.skipped.noConsent}</b> e {preview.data.skipped.optedOut} que pediram para sair.</>
          :'Escolha etiquetas ou etapas para ver o alcance.'}</p>
        <p className="broadcast-consent-help">O <b>consentimento</b> é a autorização do contato para receber suas mensagens (exigência da LGPD). Contatos sem consentimento ficam de fora do disparo e não recebem nada. O consentimento é registrado em <Link to="/contacts">Contatos</Link>.</p>
        {!filtered&&<div className="broadcast-all"><label className="check"><input type="checkbox" checked={allContacts} onChange={event=>{setAllContacts(event.target.checked);setConfirmedAll(false)}}/> Enviar para toda a base com consentimento</label>
          {allContacts&&<div className="broadcast-all-confirm"><p>Sem filtro, o disparo vai para <b>todos os {eligible} contatos elegíveis</b> da base{preview.data?`; ${preview.data.skipped.noConsent} sem consentimento e ${preview.data.skipped.optedOut} que pediram para sair não recebem`:''}.</p><label className="check"><input type="checkbox" checked={confirmedAll} onChange={event=>setConfirmedAll(event.target.checked)}/> Confirmo o envio para os {eligible} contatos elegíveis</label></div>}</div>}
      </div>
      {error&&<p className="broadcast-error" role="alert">{error}</p>}
      <footer><button onClick={()=>setOpen(false)}>Cancelar</button><button className="primary" onClick={submit} disabled={!canCreateBroadcast({name:form.name,channelId:form.channelId,body:form.body,audience:form.audience,allContacts,confirmedAll,eligible,pending:create.isPending})}>Criar como rascunho</button></footer>
    </section>}

    {list.data?.length
      ? <div className="broadcast-list">{list.data.map(item=>{
          const percent=progressPercent(item.progress);
          return <article key={item.id} className="panel">
            <header><div><b>{item.name}</b><small>{item.channel.displayName} · início {formatDate(item.startAt)} · {item.minIntervalSeconds}–{item.maxIntervalSeconds}s entre envios · {item.dailyQuota}/dia</small></div><span className={`broadcast-status ${item.status.toLowerCase()}`}>{STATUS[item.status]}</span></header>
            <p className="broadcast-body">{item.body}</p>
            <div className="broadcast-progress"><i><em style={{width:`${percent}%`}}/></i><span>{progressSummary(item.progress)}</span></div>
            <footer>
              {(item.status==='DRAFT'||item.status==='PAUSED')&&<button onClick={()=>run(item.id,'start',item.status==='PAUSED'?'Disparo retomado.':'Disparo iniciado.')} disabled={action.isPending}><Play size={14}/> {item.status==='PAUSED'?'Retomar':'Começar'}</button>}
              {item.status==='RUNNING'&&<button onClick={()=>run(item.id,'pause','Disparo pausado.')} disabled={action.isPending}><Pause size={14}/> Pausar</button>}
              {item.status!=='DONE'&&item.status!=='CANCELLED'&&<button className="danger" onClick={()=>{if(window.confirm('Cancelar este disparo? Os envios que ainda não saíram não serão enviados.'))run(item.id,'cancel','Disparo cancelado.')}} disabled={action.isPending}>Cancelar</button>}
            </footer>
          </article>})}</div>
      : <EmptyState title="Nenhum disparo criado" actionLabel={connected.length?'Criar primeiro disparo':undefined} onAction={()=>setOpen(true)}>Um disparo envia a mesma mensagem para a base, com intervalo aleatório entre os envios e um teto por dia.</EmptyState>}
  </div>
}
