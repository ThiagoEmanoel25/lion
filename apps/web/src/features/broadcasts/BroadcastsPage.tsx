import {useEffect,useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import {Pause,Play,X} from 'lucide-react';
import {ErrorState,LoadingState} from '../../shared/ui/AsyncState';
import {useToast} from '../../shared/ui/Toast';
import {useBroadcastAction,useBroadcastDependencies,useBroadcastPreview,useBroadcasts,useCreateBroadcast,type BroadcastAudience,type BroadcastInput} from './api/queries';
import {describeApiError} from '../settings/errors';
import {buildAudiencePayload,canCreateBroadcast,hasAudienceFilter,progressPercent,progressSummary} from './audience';
import '../../shared/ui/page-kit.css';
import './broadcasts.css';

const STATUS={DRAFT:'Rascunho',RUNNING:'Enviando',PAUSED:'Pausado',DONE:'Concluído',CANCELLED:'Cancelado'} as const;
const STATUS_TONE={DRAFT:'',RUNNING:'on',PAUSED:'warn',DONE:'',CANCELLED:'bad'} as const;
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

  if(list.isLoading)return <div className="page ui-page"><LoadingState/></div>;
  if(list.isError)return <div className="page ui-page"><ErrorState title="Não foi possível carregar os disparos." error={list.error} retry={()=>list.refetch()}/></div>;
  const run=(id:string,kind:'start'|'pause'|'cancel',done:string)=>action.mutate({id,action:kind},{onSuccess:()=>toast.success(done),onError:error=>toast.error(describeApiError(error,'Não foi possível concluir a ação.'))});
  const eligible=preview.data?.eligible??0;
  return <div className="page ui-page broadcasts-page">
    <header className="ui-head"><div><h1>Disparos em massa</h1><p>Envio para a base com intervalo aleatório e cota diária, porque o WhatsApp bloqueia número que envia em rajada.</p></div><div className="ui-head-actions"><button type="button" className="ui-btn primary" onClick={()=>setOpen(true)} disabled={!connected.length} title={connected.length?undefined:'Conecte um número para criar disparos'}>＋ Novo disparo</button></div></header>
    {!connected.length&&<p className="ui-notice warn broadcast-warning">Nenhum número conectado. Conecte um número em <Link to="/connections">Conexões</Link> antes de criar um disparo.</p>}

    {open&&<section className="broadcast-form" aria-label="Novo disparo">
      <header><div><h2>Novo disparo</h2><p>Só entram contatos com consentimento registrado que não pediram para sair.</p></div><button type="button" className="ui-btn quiet sm" onClick={()=>setOpen(false)} aria-label="Fechar"><X size={16} aria-hidden="true"/></button></header>
      <div className="broadcast-fields">
        <label className="ui-field">Nome<input value={form.name} maxLength={120} onChange={event=>setForm({...form,name:event.target.value})} placeholder="Ex.: Promoção de outubro"/></label>
        <label className="ui-field">Conexão<select value={form.channelId} onChange={event=>setForm({...form,channelId:event.target.value})}><option value="">Escolha a conexão</option>{connected.map(channel=><option key={channel.id} value={channel.id}>{channel.displayName}</option>)}</select></label>
        <label className="ui-field wide">Mensagem<textarea rows={4} value={form.body} maxLength={4096} onChange={event=>setForm({...form,body:event.target.value})} placeholder="Use {{contact.name}} para personalizar."/></label>
        <label className="ui-field">Início<input type="datetime-local" value={form.startAt} onChange={event=>setForm({...form,startAt:event.target.value})}/></label>
        <label className="ui-field">Cota por dia<input type="number" min={1} max={1000} value={form.dailyQuota} onChange={event=>setForm({...form,dailyQuota:Number(event.target.value)})}/></label>
        <label className="ui-field">Intervalo mínimo (s)<input type="number" min={20} max={3600} value={form.minIntervalSeconds} onChange={event=>setForm({...form,minIntervalSeconds:Number(event.target.value)})}/></label>
        <label className="ui-field">Intervalo máximo (s)<input type="number" min={20} max={3600} value={form.maxIntervalSeconds} onChange={event=>setForm({...form,maxIntervalSeconds:Number(event.target.value)})}/></label>
      </div>
      <div className="broadcast-audience">
        <h3>Público</h3>
        {(dependencies.data?.tags??[]).length>0&&<div className="broadcast-chips" role="group" aria-label="Etiquetas">{(dependencies.data?.tags??[]).map(tag=><button key={tag.id} type="button" className={`ui-btn sm${form.audience.tagIds.includes(tag.id)?' active':''}`} aria-pressed={form.audience.tagIds.includes(tag.id)} onClick={()=>changeAudience({...form.audience,tagIds:toggle(form.audience.tagIds,tag.id)})}>{tag.name}</button>)}</div>}
        {stages.length>0&&<div className="broadcast-chips" role="group" aria-label="Etapas">{stages.map(item=><button key={item.stage} type="button" className={`ui-btn sm${form.audience.stages.includes(item.stage)?' active':''}`} aria-pressed={form.audience.stages.includes(item.stage)} onClick={()=>changeAudience({...form.audience,stages:toggle(form.audience.stages,item.stage)})}>{item.stage} <small>{item.count}</small></button>)}</div>}
        <p className="broadcast-reach" aria-live="polite">{preview.isPending?'Calculando alcance…':preview.data
          ?<>Alcança <b>{eligible}</b> de {preview.data.matched} contatos encontrados. Ficam de fora <b>sem consentimento: {preview.data.skipped.noConsent}</b> e {preview.data.skipped.optedOut} que pediram para sair.</>
          :'Escolha etiquetas ou etapas para ver o alcance.'}</p>
        <p className="broadcast-consent-help">O <b>consentimento</b> é a autorização do contato para receber suas mensagens (exigência da LGPD). Contatos sem consentimento ficam de fora do disparo e não recebem nada. O consentimento é registrado em <Link to="/contacts">Contatos</Link>.</p>
        {!filtered&&<div className="broadcast-all"><label className="ui-check"><input type="checkbox" checked={allContacts} onChange={event=>{setAllContacts(event.target.checked);setConfirmedAll(false)}}/> Enviar para toda a base com consentimento</label>
          {allContacts&&<div className="broadcast-all-confirm"><p>Sem filtro, o disparo vai para <b>todos os {eligible} contatos elegíveis</b> da base{preview.data?`; ${preview.data.skipped.noConsent} sem consentimento e ${preview.data.skipped.optedOut} que pediram para sair não recebem`:''}.</p><label className="ui-check"><input type="checkbox" checked={confirmedAll} onChange={event=>setConfirmedAll(event.target.checked)}/> Confirmo o envio para os {eligible} contatos elegíveis</label></div>}</div>}
      </div>
      {error&&<p className="ui-alert broadcast-error" role="alert">{error}</p>}
      <footer><button type="button" className="ui-btn primary" onClick={submit} disabled={!canCreateBroadcast({name:form.name,channelId:form.channelId,body:form.body,audience:form.audience,allContacts,confirmedAll,eligible,pending:create.isPending})}>Criar como rascunho</button><button type="button" className="ui-btn quiet" onClick={()=>setOpen(false)}>Cancelar</button></footer>
    </section>}

    {list.data?.length
      ? <ul className="ui-rows broadcast-list">{list.data.map(item=>{
          const percent=progressPercent(item.progress);
          return <li key={item.id} className="broadcast-item">
            <div className="broadcast-head"><div className="grow"><b>{item.name}</b><small>{item.channel.displayName} · início {formatDate(item.startAt)} · {item.minIntervalSeconds}–{item.maxIntervalSeconds}s entre envios · {item.dailyQuota}/dia</small></div><span className={`ui-status ${STATUS_TONE[item.status]} broadcast-status ${item.status.toLowerCase()}`}>{STATUS[item.status]}</span></div>
            <p className="broadcast-body">{item.body}</p>
            <div className="broadcast-progress"><i><em style={{width:`${percent}%`}}/></i><span>{progressSummary(item.progress)}</span></div>
            <div className="broadcast-actions">
              {(item.status==='DRAFT'||item.status==='PAUSED')&&<button type="button" className="ui-btn sm" onClick={()=>run(item.id,'start',item.status==='PAUSED'?'Disparo retomado.':'Disparo iniciado.')} disabled={action.isPending}><Play size={14} aria-hidden="true"/> {item.status==='PAUSED'?'Retomar':'Começar'}</button>}
              {item.status==='RUNNING'&&<button type="button" className="ui-btn sm" onClick={()=>run(item.id,'pause','Disparo pausado.')} disabled={action.isPending}><Pause size={14} aria-hidden="true"/> Pausar</button>}
              {item.status!=='DONE'&&item.status!=='CANCELLED'&&<button type="button" className="ui-btn danger sm" onClick={()=>{if(window.confirm('Cancelar este disparo? Os envios que ainda não saíram não serão enviados.'))run(item.id,'cancel','Disparo cancelado.')}} disabled={action.isPending}>Cancelar</button>}
            </div>
          </li>})}</ul>
      : <div className="ui-empty"><b>Nenhum disparo criado.</b>Um disparo envia a mesma mensagem para a base, com intervalo aleatório entre os envios e um teto por dia.{connected.length>0&&<><br/><button type="button" className="ui-btn primary" onClick={()=>setOpen(true)}>Criar primeiro disparo</button></>}</div>}
  </div>
}
