import {useEffect,useMemo,useState} from 'react';
import type {ChannelFlowSettingsChannel,ChannelFlowSettingsInput,ChannelFlowSlot,ChannelKeywordMatch} from '../../shared/types/api';
import {ErrorState,LoadingState} from '../../shared/ui/AsyncState';
import {useBulkChannelFlowSettings,useChannelFlowSettings,useSaveChannelFlowSettings} from './api/queries';

const slots:Array<{id:ChannelFlowSlot;title:string;description:string}>=[
  {id:'WELCOME',title:'Boas-vindas',description:'Primeiro contato recebido nesta conexão.'},
  {id:'DEFAULT_RESPONSE',title:'Resposta padrão',description:'Fallback quando nenhuma palavra-chave combinar.'},
  {id:'CONVERSATION_RESOLVED',title:'Conversa finalizada',description:'Executado quando a conversa for marcada como resolvida.'},
  {id:'HANDOFF_CLOSED',title:'Atendimento humano encerrado',description:'Executado quando o atendimento sair do modo humano.'}
];

function toInput(channel:ChannelFlowSettingsChannel):ChannelFlowSettingsInput{
  const values=Object.fromEntries(slots.map(slot=>[slot.id,channel.flowConfigs.find(item=>item.slot===slot.id)?.playbookId??null])) as Record<ChannelFlowSlot,string|null>;
  return {slots:values,defaultResponseWindowHours:channel.flowConfigs.find(item=>item.slot==='DEFAULT_RESPONSE')?.windowHours??24,keywords:channel.keywords.map(item=>({keyword:item.keyword,match:item.match,playbookId:item.playbookId}))};
}

function configuredCount(channel:ChannelFlowSettingsChannel){return channel.flowConfigs.length}
function mutationError(error:unknown){return error instanceof Error?error.message:'Não foi possível salvar a configuração.'}

export function DefaultFlowsPanel(){
  const query=useChannelFlowSettings();const bulk=useBulkChannelFlowSettings();
  const [search,setSearch]=useState('');const [filter,setFilter]=useState<'all'|'incomplete'|'empty'>('all');const [open,setOpen]=useState<string|null>(null);const [selected,setSelected]=useState<string[]>([]);const [sourceId,setSourceId]=useState('');const [notice,setNotice]=useState('');
  const channels=useMemo(()=>query.data?.channels.filter(channel=>{const matches=channel.displayName.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))||channel.phoneNumber.includes(search.replace(/\D/g,''));if(!matches)return false;const count=configuredCount(channel);return filter==='all'||(filter==='empty'?count===0:channel.flowConfigs.length<slots.length)})??[],[query.data,search,filter]);
  if(query.isLoading)return <LoadingState/>;
  if(query.isError)return <ErrorState error={query.error} retry={()=>query.refetch()}/>;
  const toggle=(id:string)=>setSelected(items=>items.includes(id)?items.filter(item=>item!==id):[...items,id]);
  async function applyBulk(){const source=query.data?.channels.find(channel=>channel.id===sourceId);if(!source||!selected.length)return;setNotice('');try{await bulk.mutateAsync({channelIds:selected,input:toInput(source)});setNotice(`Configuração aplicada em ${selected.length} ${selected.length===1?'conexão':'conexões'}.`)}catch(error){setNotice(mutationError(error))}}
  return <section className="default-flows">
    <div className="default-flows-heading"><div><h2>Fluxos padrão por conexão</h2><p>Defina entradas automáticas e palavras-chave sem precisar alterar o desenho de cada fluxo.</p></div><span>{query.data?.channels.length??0} conexões</span></div>
    <div className="default-flows-toolbar"><label className="flow-search">Buscar conexão<input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Nome ou telefone"/></label><label>Exibir<select value={filter} onChange={event=>setFilter(event.target.value as typeof filter)}><option value="all">Todas</option><option value="incomplete">Incompletas</option><option value="empty">Sem configuração</option></select></label></div>
    <div className="flow-bulk"><strong>{selected.length} selecionada(s)</strong><select value={sourceId} onChange={event=>setSourceId(event.target.value)}><option value="">Copiar configuração de…</option>{query.data?.channels.map(channel=><option key={channel.id} value={channel.id}>{channel.displayName}</option>)}</select><button className="primary" disabled={!sourceId||!selected.length||bulk.isPending} onClick={()=>void applyBulk()}>{bulk.isPending?'Aplicando…':'Aplicar às selecionadas'}</button></div>
    {notice&&<p className={bulk.isError?'flow-notice error':'flow-notice'}>{notice}</p>}
    <div className="default-flow-list">{channels.map(channel=>{const count=configuredCount(channel);return <article className={open===channel.id?'open':''} key={channel.id}><header><input aria-label={`Selecionar ${channel.displayName}`} type="checkbox" checked={selected.includes(channel.id)} onChange={()=>toggle(channel.id)}/><span className={`channel-dot ${channel.status.toLocaleLowerCase()}`}/><button className="flow-channel-title" onClick={()=>setOpen(value=>value===channel.id?null:channel.id)}><b>{channel.displayName}</b><small>{channel.phoneNumber} · {channel.status==='CONNECTED'?'Conectada':'Desconectada'}{channel.keywords.length?` · ${channel.keywords.length} palavra(s)-chave`:''}</small></button><span className={count?'configured':'empty'}>{count}/4 configurados</span><button className="flow-expand" onClick={()=>setOpen(value=>value===channel.id?null:channel.id)} aria-label={open===channel.id?'Fechar configuração':'Abrir configuração'}>{open===channel.id?'−':'+'}</button></header>{open===channel.id&&<ChannelFlowEditor channel={channel} playbooks={query.data?.playbooks??[]}/>}</article>})}{channels.length===0&&<div className="flow-empty">Nenhuma conexão corresponde aos filtros.</div>}</div>
  </section>
}

function ChannelFlowEditor({channel,playbooks}:{channel:ChannelFlowSettingsChannel;playbooks:Array<{id:string;name:string;status:string}>}){
  const save=useSaveChannelFlowSettings();const [draft,setDraft]=useState(()=>toInput(channel));const [notice,setNotice]=useState('');
  useEffect(()=>setDraft(toInput(channel)),[channel]);
  const published=playbooks.filter(item=>item.status==='PUBLISHED');
  const setSlot=(slot:ChannelFlowSlot,value:string)=>setDraft(current=>({...current,slots:{...current.slots,[slot]:value||null}}));
  const addKeyword=()=>setDraft(current=>({...current,keywords:[...current.keywords,{keyword:'',match:'EXACT',playbookId:''}]}));
  const changeKeyword=(index:number,field:'keyword'|'match'|'playbookId',value:string)=>setDraft(current=>({...current,keywords:current.keywords.map((item,itemIndex)=>itemIndex===index?{...item,[field]:value}:item) as ChannelFlowSettingsInput['keywords']}));
  const removeKeyword=(index:number)=>setDraft(current=>({...current,keywords:current.keywords.filter((_,itemIndex)=>itemIndex!==index)}));
  const invalidKeyword=draft.keywords.some(item=>!item.keyword.trim()||!item.playbookId);
  async function submit(){setNotice('');try{await save.mutateAsync({channelId:channel.id,input:draft});setNotice('Configuração salva e pronta para receber mensagens.')}catch(error){setNotice(mutationError(error))}}
  return <div className="channel-flow-editor">
    <div className="slot-grid">{slots.map(slot=><label className="slot-card" key={slot.id}><span><b>{slot.title}</b><small>{slot.description}</small></span><select value={draft.slots[slot.id]??''} onChange={event=>setSlot(slot.id,event.target.value)}><option value="">Não executar fluxo</option>{playbooks.map(playbook=><option key={playbook.id} value={playbook.id} disabled={playbook.status!=='PUBLISHED'}>{playbook.name}{playbook.status==='PAUSED'?' (pausado)':''}</option>)}</select>{slot.id==='DEFAULT_RESPONSE'&&<span className="response-window">Não repetir por <input type="number" min={1} max={720} value={draft.defaultResponseWindowHours} onChange={event=>setDraft(current=>({...current,defaultResponseWindowHours:Number(event.target.value)}))}/> horas</span>}</label>)}</div>
    <div className="keyword-section"><div><b>Palavras-chave</b><p>A correspondência exata tem prioridade; depois vence a expressão “contém” mais longa.</p></div>{draft.keywords.map((item,index)=><div className="keyword-row" key={index}><input aria-label="Palavra-chave" value={item.keyword} maxLength={80} placeholder="Ex.: suporte" onChange={event=>changeKeyword(index,'keyword',event.target.value)}/><select aria-label="Modo da palavra-chave" value={item.match} onChange={event=>changeKeyword(index,'match',event.target.value as ChannelKeywordMatch)}><option value="EXACT">É exatamente</option><option value="CONTAINS">Contém</option></select><select aria-label="Fluxo da palavra-chave" value={item.playbookId} onChange={event=>changeKeyword(index,'playbookId',event.target.value)}><option value="">Selecione o fluxo</option>{published.map(playbook=><option key={playbook.id} value={playbook.id}>{playbook.name}</option>)}</select><button aria-label="Remover palavra-chave" onClick={()=>removeKeyword(index)}>×</button></div>)}<button className="add-keyword" disabled={draft.keywords.length>=50} onClick={addKeyword}>＋ Adicionar palavra-chave</button></div>
    <footer><span className={save.isError?'error':''}>{notice}</span><button onClick={()=>{setDraft(toInput(channel));setNotice('Alterações descartadas.')}}>Descartar</button><button className="primary" disabled={save.isPending||invalidKeyword||draft.defaultResponseWindowHours<1||draft.defaultResponseWindowHours>720} onClick={()=>void submit()}>{save.isPending?'Salvando…':'Salvar configuração'}</button></footer>
  </div>
}
