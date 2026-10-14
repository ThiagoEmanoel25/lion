import {useDeferredValue,useEffect,useMemo,useRef,useState} from 'react';
import {useSession} from '../../app/providers/SessionProvider';
import {EmptyState,ErrorState,LoadingState} from '../../shared/ui/AsyncState';
import type {Conversation,ConversationStatus,Execution,Message} from '../../shared/types/api';
import {useAssignConversation,useConversation,useConversationMode,useConversations,useConversationStatus,useMarkConversationRead,useSendMessage,useWorkspaceMembers} from './api/queries';
import './inbox.css';

const statusLabel:Record<ConversationStatus,string>={NEW:'Nova',AUTOMATED:'Em automação',WAITING_CUSTOMER:'Aguardando cliente',QUEUED:'Na fila',ASSIGNED:'Em atendimento',RESOLVED:'Resolvida'};
const stepLabel:Record<string,string>={trigger:'Gatilho',message:'Mensagem',agent:'Agente de IA',condition:'Condição',delay:'Espera',webhook:'Webhook',assign:'Atribuição',tag:'Etiqueta',handoff:'Transferência',outcome:'Desfecho'};
const executionStatus:Record<string,string>={RUNNING:'Em execução',WAITING:'Aguardando',SUCCEEDED:'Concluída',FAILED:'Falhou',CANCELLED:'Cancelada'};

function initials(name:string|null){return (name??'?').split(/\s+/).filter(Boolean).map(part=>part[0]).slice(0,2).join('').toUpperCase()}
function time(value:string){return new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(value))}
function dateTime(value:string){return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value))}
function messageState(message:Message){if(message.status==='FAILED')return `Falhou${message.errorCode?` · ${message.errorCode}`:''}`;return ({PENDING:'Pendente',QUEUED:'Na fila',SENT:'Enviada',DELIVERED:'Entregue',READ:'Lida'} as Record<string,string>)[message.status]??message.status}

function ConversationRow({conversation,active,onSelect}:{conversation:Conversation;active:boolean;onSelect:()=>void}){
  const last=conversation.messages[0];
  return <button className={active?'active':''} onClick={onSelect} aria-pressed={active}>
    <span className="avatar">{initials(conversation.contact.name)}</span>
    <div><b>{conversation.contact.name??conversation.contact.phone}</b><p>{last?.body??'Sem mensagens'}</p><small className={`mode-${conversation.mode.toLowerCase()}`}>{conversation.mode==='AI'?'✦ IA em atendimento':conversation.mode==='HUMAN'?'● Atendimento humano':'◷ Na fila'}</small></div>
    <span className="conversation-meta"><time>{time(conversation.updatedAt)}</time>{conversation.unreadCount>0&&<em>{conversation.unreadCount}</em>}</span>
  </button>
}

function ExecutionTimeline({execution}:{execution:Execution}){
  return <section className="execution-timeline">
    <header><div><b>{execution.playbookVersion?.playbook.name??'Execução da automação'}</b><small>Versão {execution.playbookVersion?.version??'—'} · iniciada {dateTime(execution.startedAt)}</small></div><span className={`execution-status status-${execution.status.toLowerCase()}`}>{executionStatus[execution.status]??execution.status}</span></header>
    {execution.steps.length===0?<p className="timeline-empty">A execução ainda não registrou etapas.</p>:<ol>{execution.steps.map(step=><li key={step.id} className={`step-${step.status.toLowerCase()}`}><i/><div><b>{stepLabel[step.kind]??step.kind}</b><small>{step.reason??(step.status==='SUCCEEDED'?'Etapa executada sem intercorrências.':executionStatus[step.status]??step.status)}</small></div><time>{step.durationMs===null?'—':`${step.durationMs} ms`}</time></li>)}</ol>}
  </section>
}

export function InboxPage(){
  const {session}=useSession();
  const [activeId,setActiveId]=useState<string|null>(null);
  const [search,setSearch]=useState('');
  const deferredSearch=useDeferredValue(search.trim());
  const [status,setStatus]=useState<''|ConversationStatus>('');
  const [mode,setMode]=useState<''|'AI'|'HUMAN'|'PAUSED'>('');
  const [text,setText]=useState('');
  const [showExecution,setShowExecution]=useState(false);
  const list=useConversations({search:deferredSearch,status,mode});
  const conversations=useMemo(()=>list.data?.pages.flatMap(page=>page.items)??[],[list.data]);
  const detail=useConversation(activeId);
  const changeMode=useConversationMode();
  const changeStatus=useConversationStatus();
  const sendMessage=useSendMessage();
  const markRead=useMarkConversationRead();
  const assign=useAssignConversation();
  const workspace=useWorkspaceMembers();
  const messagesEnd=useRef<HTMLDivElement>(null);
  const active=detail.data;

  useEffect(()=>{if(!activeId&&conversations[0])setActiveId(conversations[0].id)},[activeId,conversations]);
  useEffect(()=>{if(activeId&&active?.unreadCount)markRead.mutate(activeId)},[activeId,active?.unreadCount]);
  useEffect(()=>{messagesEnd.current?.scrollIntoView({block:'end'})},[active?.messages.length]);
  useEffect(()=>setShowExecution(false),[activeId]);

  async function handoff(){if(!active)return;await changeMode.mutateAsync({id:active.id,mode:active.mode==='HUMAN'?'AI':'HUMAN',reason:active.mode==='HUMAN'?'Operador devolveu o atendimento para a IA.':'Operador assumiu o atendimento.'})}
  async function toggleResolved(){if(!active)return;await changeStatus.mutateAsync({id:active.id,status:active.status==='RESOLVED'?'QUEUED':'RESOLVED',reason:active.status==='RESOLVED'?'Conversa reaberta pelo operador.':'Conversa resolvida pelo operador.'})}
  async function send(){const body=text.trim();if(!active||!body||active.mode!=='HUMAN')return;setText('');try{await sendMessage.mutateAsync({id:active.id,body})}catch{setText(body)}}
  const execution=active?.executions?.[0];

  return <div className="inbox">
    <aside className="conversation-list">
      <header><h1>Chats ao vivo</h1><span>{conversations.reduce((total,item)=>total+item.unreadCount,0)} novas</span></header>
      <label className="conversation-search">⌕<input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Buscar nome, telefone ou e-mail"/></label>
      <div className="conversation-filters"><select value={status} onChange={event=>setStatus(event.target.value as ''|ConversationStatus)} aria-label="Filtrar por status"><option value="">Todos os status</option>{Object.entries(statusLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><select value={mode} onChange={event=>setMode(event.target.value as typeof mode)} aria-label="Filtrar por modo"><option value="">IA e humano</option><option value="AI">IA</option><option value="HUMAN">Humano</option><option value="PAUSED">Pausada</option></select></div>
      {list.isLoading?<LoadingState/>:list.isError?<ErrorState error={list.error} retry={()=>void list.refetch()}/>:conversations.length===0?<EmptyState title="Nenhuma conversa encontrada">Ajuste os filtros ou aguarde uma nova mensagem.</EmptyState>:<>{conversations.map(conversation=><ConversationRow key={conversation.id} conversation={conversation} active={activeId===conversation.id} onSelect={()=>setActiveId(conversation.id)}/>)}{list.hasNextPage&&<button className="load-more" onClick={()=>void list.fetchNextPage()} disabled={list.isFetchingNextPage}>{list.isFetchingNextPage?'Carregando…':'Carregar mais'}</button>}</>}
    </aside>

    <section className="chat">
      {!activeId?<EmptyState title="Selecione uma conversa">As mensagens e a execução aparecerão aqui.</EmptyState>:detail.isLoading?<LoadingState/>:detail.isError?<ErrorState error={detail.error} retry={()=>void detail.refetch()}/>:active&&<>
        <header><span className="avatar">{initials(active.contact.name)}</span><div><h2>{active.contact.name??active.contact.phone}</h2><small>● {active.mode==='HUMAN'?(active.assignee?.name?`Com ${active.assignee.name}`:'Atendimento humano'):active.mode==='AI'?'IA atendendo agora':'Atendimento pausado'} · {active.contact.phone}</small></div><div className="chat-actions"><button onClick={()=>void toggleResolved()} disabled={changeStatus.isPending}>{active.status==='RESOLVED'?'Reabrir':'Resolver'}</button><button className={active.mode==='HUMAN'?'return-ai':'take-over'} onClick={()=>void handoff()} disabled={changeMode.isPending}>{changeMode.isPending?'Atualizando…':active.mode==='HUMAN'?'Devolver para IA':'Assumir conversa'}</button></div></header>
        {execution&&<div className="execution"><span>✦</span><div><b>{execution.playbookVersion?.playbook.name??'Automação em execução'}</b><small>{executionStatus[execution.status]??execution.status} · {execution.steps.length} etapa(s) registrada(s)</small></div><button onClick={()=>setShowExecution(value=>!value)}>{showExecution?'Ocultar':'Ver execução'}</button></div>}
        {showExecution&&execution&&<ExecutionTimeline execution={execution}/>}
        <div className="messages">{active.messages.length===0?<EmptyState title="Ainda não há mensagens"/>:active.messages.map(message=><div key={message.id} className={message.direction==='OUTBOUND'?'out':''}>{message.direction==='OUTBOUND'&&<small>{message.authorType==='ai'?'✦ RESPOSTA DA IA':'RESPOSTA DA EQUIPE'}</small>}<p>{message.body??`[${message.type??'mensagem'}]`}</p><time>{time(message.createdAt)} · {messageState(message)}</time></div>)}<div ref={messagesEnd}/></div>
        <form onSubmit={event=>{event.preventDefault();void send()}}><small>{sendMessage.isError?`Falha ao enviar: ${sendMessage.error.message}`:active.mode==='HUMAN'?'Você está respondendo como operador. A IA está pausada.':'Assuma a conversa para responder.'}</small><div><textarea value={text} onChange={event=>setText(event.target.value)} disabled={active.mode!=='HUMAN'||sendMessage.isPending||active.status==='RESOLVED'} placeholder={active.status==='RESOLVED'?'Reabra a conversa para responder':active.mode==='HUMAN'?'Digite sua mensagem…':'A IA está conduzindo esta conversa…'}/><button disabled={active.mode!=='HUMAN'||!text.trim()||sendMessage.isPending||active.status==='RESOLVED'} aria-label="Enviar mensagem">➤</button></div></form>
      </>}
    </section>

    <aside className="contact-detail">{active&&<><header>Contato <b>{statusLabel[active.status]}</b></header><span className="avatar large">{initials(active.contact.name)}</span><h3>{active.contact.name??'Contato sem nome'}</h3><p>{active.contact.source??'Origem não informada'} · {active.contact.phone}</p><section><small>ATENDIMENTO</small><label className="assignee-field">Responsável<select value={active.assignee?.id??''} disabled={active.mode!=='HUMAN'||assign.isPending} onChange={event=>void assign.mutateAsync({id:active.id,assigneeId:event.target.value||null})}><option value="">Não atribuído</option>{workspace.data?.memberships.filter(member=>member.user.isActive&&(session?.workspace.role!=='AGENT'||member.user.id===session.user.id)).map(member=><option key={member.user.id} value={member.user.id}>{member.user.name}</option>)}</select></label><dl><div><dt>Status</dt><dd>{statusLabel[active.status]}</dd></div><div><dt>Fila</dt><dd>{active.queue??'Geral'}</dd></div></dl></section><section><small>DADOS DO CONTATO</small><dl><div><dt>Etapa</dt><dd>{active.contact.stage}</dd></div><div><dt>E-mail</dt><dd>{active.contact.email??'—'}</dd></div>{Object.entries(active.contact.customFields??{}).slice(0,5).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl></section><section><small>ETIQUETAS</small><p className="tags">{active.contact.tags?.length?active.contact.tags.map(({tag})=><i key={tag.id} style={{borderColor:tag.color}}>{tag.name}</i>):<span className="muted">Sem etiquetas</span>}</p></section></>}
    </aside>
  </div>
}
