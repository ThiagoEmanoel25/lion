import {useEffect,useMemo,useState} from 'react';
import {Pause,Play,X} from 'lucide-react';
import {EmptyState,ErrorState,LoadingState} from '../../shared/ui/AsyncState';
import {useBroadcastAction,useBroadcastDependencies,useBroadcastPreview,useBroadcasts,useCreateBroadcast,type BroadcastAudience,type BroadcastInput} from './api/queries';
import './broadcasts.css';

const STATUS={DRAFT:'Rascunho',RUNNING:'Enviando',PAUSED:'Pausado',DONE:'Concluído',CANCELLED:'Cancelado'} as const;
const localNow=()=>{const date=new Date(Date.now()+5*60_000);return new Date(date.getTime()-date.getTimezoneOffset()*60_000).toISOString().slice(0,16)};
const emptyAudience:BroadcastAudience={tagIds:[],stages:[],contactIds:[]};
const formatDate=(value:string)=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value));

export function BroadcastsPage(){
  const list=useBroadcasts(),dependencies=useBroadcastDependencies();
  const create=useCreateBroadcast(),action=useBroadcastAction(),preview=useBroadcastPreview();
  const [open,setOpen]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [form,setForm]=useState<BroadcastInput>({name:'',channelId:'',body:'',startAt:localNow(),minIntervalSeconds:45,maxIntervalSeconds:180,dailyQuota:200,audience:emptyAudience});
  const connected=useMemo(()=>(dependencies.data?.channels??[]).filter(channel=>channel.status==='CONNECTED'),[dependencies.data]);
  const stages=useMemo(()=>(dependencies.data?.stages??[]).filter(item=>item.count>0),[dependencies.data]);
  const audienceKey=JSON.stringify(form.audience);
  // A prévia roda sozinha a cada mudança de público: quem dispara precisa ver o alcance antes, não depois.
  useEffect(()=>{if(open)preview.mutate(JSON.parse(audienceKey) as BroadcastAudience)},[open,audienceKey]);

  function toggle(list:string[],value:string){return list.includes(value)?list.filter(item=>item!==value):[...list,value]}
  async function submit(){
    setError(null);
    try{
      await create.mutateAsync({...form,startAt:new Date(form.startAt).toISOString()});
      setOpen(false);setForm(current=>({...current,name:'',body:'',audience:emptyAudience}));
    }catch(failure){setError(failure instanceof Error?failure.message:'Não foi possível criar o disparo.')}
  }

  if(list.isLoading)return <div className="page"><LoadingState/></div>;
  if(list.isError)return <div className="page"><ErrorState error={list.error} retry={()=>list.refetch()}/></div>;
  const eligible=preview.data?.eligible??0;
  return <div className="page">
    <div className="heading"><div><small>OPERAÇÕES</small><h1>Disparos em massa</h1><p>Envio para a base com intervalo aleatório e cota diária, porque o WhatsApp bloqueia número que envia em rajada.</p></div><button className="primary" onClick={()=>setOpen(true)} disabled={!connected.length}>＋ Novo disparo</button></div>
    {!connected.length&&<div className="broadcast-warning">Nenhuma conexão conectada. Conecte um número antes de criar um disparo.</div>}

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
        <div className="broadcast-chips">{(dependencies.data?.tags??[]).map(tag=><button key={tag.id} type="button" className={form.audience.tagIds.includes(tag.id)?'on':''} onClick={()=>setForm({...form,audience:{...form.audience,tagIds:toggle(form.audience.tagIds,tag.id)}})}>{tag.name}</button>)}</div>
        <div className="broadcast-chips">{stages.map(item=><button key={item.stage} type="button" className={form.audience.stages.includes(item.stage)?'on':''} onClick={()=>setForm({...form,audience:{...form.audience,stages:toggle(form.audience.stages,item.stage)}})}>{item.stage} <small>{item.count}</small></button>)}</div>
        <p className="broadcast-reach">{preview.isPending?'Calculando alcance…':preview.data
          ?<>Alcança <b>{eligible}</b> de {preview.data.matched} contatos. Ficam de fora {preview.data.skipped.noConsent} sem consentimento e {preview.data.skipped.optedOut} que pediram para sair.</>
          :'Escolha etiquetas ou etapas para ver o alcance. Sem filtro, o público é toda a base com consentimento.'}</p>
      </div>
      {error&&<p className="broadcast-error">{error}</p>}
      <footer><button onClick={()=>setOpen(false)}>Cancelar</button><button className="primary" onClick={submit} disabled={create.isPending||!form.name.trim()||!form.channelId||!form.body.trim()||eligible===0}>Criar como rascunho</button></footer>
    </section>}

    {list.data?.length
      ? <div className="broadcast-list">{list.data.map(item=>{
          const percent=item.progress.total?Math.round(item.progress.sent/item.progress.total*100):0;
          return <article key={item.id} className="panel">
            <header><div><b>{item.name}</b><small>{item.channel.displayName} · início {formatDate(item.startAt)} · {item.minIntervalSeconds}–{item.maxIntervalSeconds}s entre envios · {item.dailyQuota}/dia</small></div><span className={`broadcast-status ${item.status.toLowerCase()}`}>{STATUS[item.status]}</span></header>
            <p className="broadcast-body">{item.body}</p>
            <div className="broadcast-progress"><i><em style={{width:`${percent}%`}}/></i><span>{item.progress.sent} de {item.progress.total} enviados{item.progress.failed?` · ${item.progress.failed} falharam`:''}{item.progress.cancelled?` · ${item.progress.cancelled} cancelados`:''}</span></div>
            <footer>
              {(item.status==='DRAFT'||item.status==='PAUSED')&&<button onClick={()=>action.mutate({id:item.id,action:'start'})} disabled={action.isPending}><Play size={14}/> {item.status==='PAUSED'?'Retomar':'Começar'}</button>}
              {item.status==='RUNNING'&&<button onClick={()=>action.mutate({id:item.id,action:'pause'})} disabled={action.isPending}><Pause size={14}/> Pausar</button>}
              {item.status!=='DONE'&&item.status!=='CANCELLED'&&<button className="danger" onClick={()=>{if(window.confirm('Cancelar este disparo? Os envios que ainda não saíram não serão enviados.'))action.mutate({id:item.id,action:'cancel'})}} disabled={action.isPending}>Cancelar</button>}
            </footer>
          </article>})}</div>
      : <EmptyState title="Nenhum disparo criado">Um disparo envia a mesma mensagem para a base, com intervalo aleatório entre os envios e um teto por dia.</EmptyState>}
  </div>
}
