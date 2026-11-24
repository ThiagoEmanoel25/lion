import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {QRCodeSVG} from 'qrcode.react';
import type {Channel,WhatsAppSession,MetaPixel,BusinessHours,Department,GlobalVariable,QuickReply,WorkspaceMember} from '../../shared/types/api';
import {ErrorState,LoadingState} from '../../shared/ui/AsyncState';
import {uploadPlaybookAsset,usePlaybooks} from '../playbooks/api/queries';
import {useDeleteGlobalVariable,useDeleteQuickReply,useGlobalVariables,useQuickReplies,useSaveGlobalVariable,useSaveQuickReply,useDeleteMetaPixel,useMetaPixels,useSaveMetaPixel,useAttachAutomation,useAudit,useConnectWhatsApp,useDeleteAiKey,useSaveAiKey,useWorkspaceAiKey,useBusinessHours,useChannels,useCreateInvite,useCreateWhatsAppSession,useDepartments,useDisconnectWhatsApp,useRemoveChannel,useInvites,useRevokeInvite,useSaveBusinessHours,useSaveDepartment,useUpdateMember,useUpdateWorkspace,useWhatsAppSession,useWorkspace} from './api/queries';
import {DefaultFlowsPanel} from './DefaultFlowsPanel';
import {RemoveNumberDialog,UNLINK_FAILED_HINT} from './RemoveNumberDialog';
import {ApiError,api,apiBlob} from '../../shared/api/client';
import {useToast} from '../../shared/ui/Toast';
import {useLocation} from 'react-router-dom';
import {describeApiError} from './errors';
import {INVITE_STATUS_LABELS,LOCALES,ROLE_LABELS,auditActionLabel,label,timeZoneList} from './labels';
import {Plus} from 'lucide-react';
import '../../shared/ui/page-kit.css';
import './settings.css';

type Tab='channels'|'default-flows'|'quick-replies'|'global-variables'|'workspace'|'team'|'departments'|'hours'|'audit'|'ai'|'pixels';
const tabs:[Tab,string][]=[['channels','Canais'],['default-flows','Fluxos padrão'],['quick-replies','Respostas rápidas'],['global-variables','Variáveis globais'],['workspace','Workspace'],['team','Equipe e acessos'],['departments','Filas e departamentos'],['hours','Horários'],['audit','Auditoria'],['ai','Inteligência artificial'],['pixels','Pixels do Facebook']];

export function SettingsPage({initialTab='channels'}:{initialTab?:Tab}){
  const connectionsPage=useLocation().pathname.startsWith('/connections');
  const [tab,setTab]=useState<Tab>(()=>{const wanted=new URLSearchParams(window.location.search).get('tab');return tabs.find(([id])=>id===wanted)?.[0]??initialTab});
  return <div className="page ui-page settings-page">
    <header className="ui-head"><div><h1>{connectionsPage?'Conexões':'Configurações'}</h1><p>{connectionsPage?'Números de WhatsApp conectados ao seu atendimento.':'Canais, equipe, filas, atendimento e segurança.'}</p></div></header>
    <div className={connectionsPage?'settings-layout single':'settings-layout'}>
      {!connectionsPage&&<nav className="settings-nav" aria-label="Seções de configurações">{tabs.map(([id,name])=><button type="button" key={id} className={tab===id?'active':''} aria-current={tab===id?'page':undefined} onClick={()=>setTab(id)}>{name}</button>)}</nav>}
      <section className="settings-body ui-section">
        {(connectionsPage||tab==='channels')&&<ChannelsPanel/>}
        {!connectionsPage&&<>
          {tab==='default-flows'&&<DefaultFlowsPanel/>}{tab==='quick-replies'&&<QuickRepliesPanel/>}{tab==='global-variables'&&<GlobalVariablesPanel/>}{tab==='workspace'&&<WorkspacePanel/>}{tab==='team'&&<TeamPanel/>}{tab==='departments'&&<DepartmentsPanel/>}{tab==='hours'&&<HoursPanel/>}{tab==='audit'&&<AuditPanel/>}{tab==='ai'&&<AiKeyPanel/>}{tab==='pixels'&&<PixelsPanel/>}
        </>}
      </section>
    </div>
  </div>
}

function ChannelsPanel(){
  const channels=useChannels();const playbooks=usePlaybooks();const create=useCreateWhatsAppSession();const connect=useConnectWhatsApp();const disconnect=useDisconnectWhatsApp();const remove=useRemoveChannel();const [removing,setRemoving]=useState<Channel|null>(null);const attach=useAttachAutomation();const toast=useToast();const [formError,setFormError]=useState('');
  const [showForm,setShowForm]=useState(false);const [selected,setSelected]=useState<string|null>(null);const [method,setMethod]=useState<'qr'|'pairing'>('qr');const session=useWhatsAppSession(selected);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);const phone=String(data.get('phoneNumber')??'').replace(/\D/g,'');setFormError('');try{const channel=await create.mutateAsync({displayName:String(data.get('displayName')??''),phoneNumber:phone,...(method==='pairing'?{pairingPhoneNumber:phone}:{})});connect.reset();setSelected(channel.id);setShowForm(false)}catch(failure){const message=describeApiError(failure,'Não foi possível criar a conexão.');setFormError(message);toast.error(message)}}
  function openSession(id:string){connect.reset();setSelected(id)}
  function reconnect(id:string){connect.reset();setSelected(id);connect.mutate(id)}
  async function confirmRemove(){const target=removing;if(!target)return;try{const result=await remove.mutateAsync(target.id);setRemoving(null);if(selected===target.id){connect.reset();setSelected(null)}toast.success('Número removido. O histórico de conversas continua disponível.');
    if(result.unlinkRequested){void (async()=>{for(let attempt=0;attempt<8;attempt++){await new Promise(resolve=>window.setTimeout(resolve,1500));try{const state=await api<WhatsAppSession>(`/v1/channels/${target.id}/session`);const runtime=state.runtime;if(runtime?.unlinkFailed){toast.error(UNLINK_FAILED_HINT);return}if(runtime&&runtime.unlinkFailed===false)return}catch{return}}})()}
  }catch(failure){toast.error(describeApiError(failure,'Não foi possível remover o número.'));setRemoving(null)}}
  return <>
    <h2>Canais de WhatsApp</h2>
    <p className="ui-help">{channels.data?`${channels.data.filter(item=>item.status==='CONNECTED').length} de ${channels.data.length} conectado(s). `:''}Use um número dedicado e evite disparos em massa.</p>
    {channels.isLoading&&<LoadingState label="Carregando canais…" lines={2}/>}{channels.isError&&<ErrorState error={channels.error} retry={()=>channels.refetch()}/>}
    {channels.data&&(channels.data.length===0?<p className="ui-empty"><b>Nenhum número conectado.</b>Conecte um número para receber e enviar mensagens.</p>:<ul className="ui-rows channel-list">{channels.data.map(channel=><li className="channel-row" key={channel.id}>
      <div className="channel-id"><b>{channel.displayName}</b><small>{channel.phoneNumber}</small></div>
      <span className={`ui-status ${statusTone(channel.status)}`}>{statusLabel(channel.status)}</span>
      <div className="ui-row-actions channel-actions">{channel.provider==='baileys'?<>{channel.status!=='CONNECTED'&&<button type="button" className="ui-btn primary sm" disabled={connect.isPending} onClick={()=>reconnect(channel.id)}>{connect.isPending&&selected===channel.id?'Conectando…':'Reconectar'}</button>}<button type="button" className="ui-btn sm" onClick={()=>openSession(channel.id)}>Sessão</button>{channel.status==='CONNECTED'&&<button type="button" className="ui-btn sm" disabled={disconnect.isPending} title="Desliga a conexão agora, mas mantém o número vinculado: depois você reconecta sem ler o QR Code de novo." onClick={()=>disconnect.mutate({id:channel.id,removeAuth:false},{onSuccess:()=>toast.success('Canal desconectado. O número continua vinculado: reconecte quando quiser, sem QR Code.'),onError:failure=>toast.error(describeApiError(failure,'Não foi possível desconectar o canal.'))})}>Desconectar</button>}</>:<span className="channel-provider">Canal externo</span>}<button type="button" className="ui-btn danger sm" onClick={()=>setRemoving(channel)}>Remover número</button></div>
      <div className="channel-extra"><label className="ui-field">Fluxo de boas-vindas (atalho)<select value={channel.activePlaybook?.id??''} onChange={event=>attach.mutate({id:channel.id,playbookId:event.target.value||null},{onError:failure=>toast.error(describeApiError(failure,'Não foi possível trocar o fluxo do canal.'))})}><option value="">Sem automação</option>{channel.activePlaybook&&channel.activePlaybook.status!=='PUBLISHED'&&<option value={channel.activePlaybook.id}>{channel.activePlaybook.name} ({channel.activePlaybook.status==='PAUSED'?'pausado':'indisponível'} — selecione outro)</option>}{playbooks.data?.filter(item=>item.status==='PUBLISHED').map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{channel.provider==='baileys'&&channel.status==='CONNECTED'&&<small className="channel-hint"><b>Desconectar</b> mantém o pareamento: reconecta sem QR Code. <b>Remover número</b> desvincula o aparelho e apaga as credenciais.</small>}</div>
    </li>)}</ul>)}
    {removing&&<RemoveNumberDialog phone={removing.phoneNumber} pending={remove.isPending} onCancel={()=>setRemoving(null)} onConfirm={()=>void confirmRemove()}/>}
    {!showForm?<button type="button" className="ui-btn" onClick={()=>setShowForm(true)}><Plus size={16} aria-hidden="true"/> Conectar outro número</button>:<form className="ui-form connect-form" onSubmit={submit}>
      <h3>Conectar outro número</h3>
      <label className="ui-field">Nome do canal<input name="displayName" required minLength={2} placeholder="Comercial principal"/></label>
      <label className="ui-field">Número com DDI e DDD<input name="phoneNumber" required inputMode="numeric" placeholder="5571999999999"/></label>
      <div className="method-toggle" role="group" aria-label="Forma de conexão"><button type="button" className={`ui-btn${method==='qr'?' active':''}`} aria-pressed={method==='qr'} onClick={()=>setMethod('qr')}>QR Code</button><button type="button" className={`ui-btn${method==='pairing'?' active':''}`} aria-pressed={method==='pairing'} onClick={()=>setMethod('pairing')}>Código no celular</button></div>
      {formError&&<p className="ui-alert" role="alert">{formError}</p>}
      <div className="ui-actions"><button className="ui-btn primary" disabled={create.isPending}>{create.isPending?'Criando…':'Conectar'}</button><button type="button" className="ui-btn quiet" onClick={()=>{setFormError('');setShowForm(false)}}>Cancelar</button></div>
    </form>}
    {selected&&<SessionModal key={selected} session={session.data} loading={session.isLoading} connecting={connect.isPending} connectError={connect.isError?describeApiError(connect.error,'Não foi possível iniciar a conexão.'):''} onConnect={()=>connect.mutate(selected)} onRemove={()=>{const target=channels.data?.find(item=>item.id===selected);if(target){connect.reset();setSelected(null);setRemoving(target)}}} onRefetch={()=>void session.refetch()} onClose={()=>{connect.reset();setSelected(null)}}/>}
  </>
}

const RUNTIME_LABELS:Record<string,string>={CONNECTED:'Conectado',CONNECTING:'Conectando ao WhatsApp…',QR:'Escaneie o QR Code',QR_READY:'Escaneie o QR Code',PAIRING:'Digite o código no celular',DISCONNECTED:'Desconectado',LOGGED_OUT:'Sessão encerrada no celular',DEGRADED:'Reconectando…',PENDING:'Aguardando conexão'};
/** Tempo máximo esperando o serviço do WhatsApp responder antes de mostrar erro com ação. */
export const RUNTIME_TIMEOUT_MS=20_000;
function SessionModal({session,loading,connecting,connectError,onConnect,onRemove,onRefetch,onClose}:{session?:WhatsAppSession;loading:boolean;connecting:boolean;connectError:string;onConnect:()=>void;onRemove:()=>void;onRefetch:()=>void;onClose:()=>void}){
  const runtime=session?.runtime;const status=runtime?.status;const [timedOut,setTimedOut]=useState(false);const [attempt,setAttempt]=useState(0);
  const waiting=!status;
  useEffect(()=>{if(!waiting){setTimedOut(false);return}const id=window.setTimeout(()=>setTimedOut(true),RUNTIME_TIMEOUT_MS);return()=>window.clearTimeout(id)},[waiting,attempt]);
  const connected=status==='CONNECTED';
  function retry(){setTimedOut(false);setAttempt(value=>value+1);onConnect();onRefetch()}
  return <div className="session-modal ui-dialog-backdrop" role="dialog" aria-modal="true" aria-label="Sessão do WhatsApp"><div className="session-box ui-dialog">
    <button type="button" className="modal-close" aria-label="Fechar" onClick={onClose}>×</button>
    <h2>{session?.displayName??'Preparando conexão'}</h2>
    {waiting&&timedOut?<><p role="alert" className="session-status">Não foi possível conectar ao serviço do WhatsApp. Tente novamente.</p><button type="button" className="ui-btn primary session-connect" disabled={connecting} onClick={retry}>Tentar novamente</button></>:<p className="session-status">{status?label(RUNTIME_LABELS,status):loading?'Preparando conexão…':'Aguardando o runtime…'}</p>}
    {runtime?.qr&&<div className="qr-area"><QRCodeSVG value={runtime.qr} size={224} level="M"/></div>}{runtime?.pairingCode&&<strong className="pairing-code">{runtime.pairingCode}</strong>}{connected&&<div className="connected-check"><span className="ui-status on">✓ Número conectado</span></div>}
    {!connected&&!waiting&&!runtime?.qr&&!runtime?.pairingCode&&<button type="button" className="ui-btn primary session-connect" disabled={connecting} onClick={onConnect}>{connecting?'Conectando…':'Reconectar agora'}</button>}
    {connectError&&<p className="ui-alert" role="alert">{connectError}</p>}
    <small className="session-help">WhatsApp → Aparelhos conectados → Conectar aparelho</small>
    <button type="button" className="ui-btn danger sm session-remove" onClick={onRemove}>Remover número</button>
  </div></div>
}

function FormAlert({message}:{message:string}){return message?<p className="ui-alert" role="alert">{message}</p>:null}

function TimeZoneSelect({name,value,onChange}:{name?:string;value:string;onChange?:(value:string)=>void}){
  const [filter,setFilter]=useState('');const zones=useMemo(()=>timeZoneList(value),[value]);
  const shown=useMemo(()=>{const term=filter.trim().toLowerCase();const list=term?zones.filter(zone=>zone.toLowerCase().includes(term)):zones;return list.includes(value)?list:[value,...list]},[zones,filter,value]);
  return <span className="tz-picker"><input type="search" aria-label="Buscar fuso horário" placeholder="Buscar fuso (ex.: Sao_Paulo)" value={filter} onChange={event=>setFilter(event.target.value)}/><select name={name} aria-label="Fuso horário" value={value} onChange={event=>onChange?.(event.target.value)}>{shown.map(zone=><option key={zone} value={zone}>{zone.replaceAll('_',' ')}</option>)}</select></span>
}

function WorkspacePanel(){
  const workspace=useWorkspace();const update=useUpdateWorkspace();const toast=useToast();const [error,setError]=useState('');const [timezone,setTimezone]=useState<string|null>(null);
  if(workspace.isLoading)return <LoadingState/>;if(workspace.isError)return <ErrorState error={workspace.error} retry={()=>workspace.refetch()}/>;
  const currentZone=timezone??workspace.data?.timezone??'America/Sao_Paulo';const currentLocale=workspace.data?.locale??'pt-BR';
  return <><h2>Dados do workspace</h2><p className="ui-help">Identificação e localização usadas em toda a operação.</p>
    <form className="ui-form flush" key={workspace.data?.updatedAt} onSubmit={async event=>{event.preventDefault();setError('');const data=new FormData(event.currentTarget);try{await update.mutateAsync({name:String(data.get('name')),timezone:currentZone,locale:String(data.get('locale'))});setTimezone(null);toast.success('Workspace atualizado.')}catch(failure){const message=describeApiError(failure,'Não foi possível salvar o workspace.');setError(message);toast.error(message)}}}>
      <label className="ui-field">Nome<input name="name" required defaultValue={workspace.data?.name}/></label>
      <label className="ui-field">Fuso horário<TimeZoneSelect value={currentZone} onChange={setTimezone}/></label>
      <label className="ui-field">Idioma<select name="locale" defaultValue={LOCALES.some(([code])=>code===currentLocale)?currentLocale:LOCALES[0]![0]}>{LOCALES.map(([code,name])=><option key={code} value={code}>{name}</option>)}</select></label>
      <FormAlert message={error}/>
      <div className="ui-actions"><button className="ui-btn primary" disabled={update.isPending}>{update.isPending?'Salvando…':'Salvar alterações'}</button></div>
    </form></>
}

function TeamPanel(){
  const workspace=useWorkspace();const invites=useInvites();const create=useCreateInvite();const revoke=useRevokeInvite();const update=useUpdateMember();const toast=useToast();const [error,setError]=useState('');
  const fail=(fallback:string)=>(failure:unknown)=>toast.error(describeApiError(failure,fallback));
  async function invite(event:FormEvent<HTMLFormElement>){event.preventDefault();setError('');const form=event.currentTarget;const data=new FormData(form);try{await create.mutateAsync({email:String(data.get('email')),name:String(data.get('name'))||undefined,role:String(data.get('role'))});form.reset();toast.success('Convite gerado. Copie o token abaixo agora.')}catch(failure){const message=describeApiError(failure,'Não foi possível gerar o convite.');setError(message);toast.error(message)}}
  return <><h2>Equipe e acessos</h2><p className="ui-help">Convites não são enviados por e-mail: copie o token exibido uma única vez e compartilhe por um canal seguro.</p>
    <form className="ui-form flush" onSubmit={invite}>
      <label className="ui-field">Nome<input name="name" placeholder="Nome do convidado"/></label>
      <label className="ui-field">E-mail<input name="email" type="email" required placeholder="email@empresa.com"/></label>
      <label className="ui-field">Papel<select name="role" defaultValue="AGENT"><option value="ADMIN">Administrador</option><option value="SUPERVISOR">Supervisor</option><option value="AGENT">Agente</option><option value="VIEWER">Leitor</option></select></label>
      <FormAlert message={error}/>
      <div className="ui-actions"><button className="ui-btn primary" disabled={create.isPending}>Gerar convite</button></div>
    </form>
    {create.data?.acceptanceToken&&<div className="token-box"><b>Token de ativação — exibido somente agora</b><code>{create.data.acceptanceToken}</code><button type="button" className="ui-btn sm" onClick={()=>void navigator.clipboard.writeText(create.data!.acceptanceToken!).then(()=>toast.success('Token copiado.'),()=>toast.error('Não foi possível copiar. Selecione o token e copie manualmente.'))}>Copiar token</button></div>}
    <h3>Membros</h3>
    <ul className="ui-rows">{workspace.data?.memberships.map(member=><li key={member.id}><div className="grow"><b>{member.user.name}</b><small>{member.user.email} · {member.isActive?'Ativo':'Desativado'}</small></div><select aria-label={`Papel de ${member.user.name}`} value={member.role} disabled={member.role==='OWNER'||update.isPending} onChange={event=>update.mutate({id:member.id,role:event.target.value},{onError:fail('Não foi possível alterar o perfil.')})}><option value="OWNER">Proprietário</option><option value="ADMIN">Administrador</option><option value="SUPERVISOR">Supervisor</option><option value="AGENT">Agente</option><option value="VIEWER">Leitor</option></select><div className="ui-row-actions"><button type="button" className={member.isActive?'ui-btn danger sm':'ui-btn sm'} disabled={member.role==='OWNER'||update.isPending} onClick={()=>update.mutate({id:member.id,isActive:!member.isActive},{onError:fail('Não foi possível atualizar o membro.')})}>{member.isActive?'Desativar':'Reativar'}</button></div></li>)}</ul>
    <h3>Convites</h3>
    {invites.data?.length===0?<p className="ui-empty">Nenhum convite. Gere um convite para adicionar alguém à equipe.</p>:<ul className="ui-rows">{invites.data?.map(invite=><li key={invite.id}><div className="grow"><b>{invite.name||invite.email}</b><small>{invite.email} · {label(ROLE_LABELS,invite.role)} · {label(INVITE_STATUS_LABELS,invite.status)}</small></div><time>{new Date(invite.expiresAt).toLocaleDateString('pt-BR')}</time><div className="ui-row-actions">{invite.status==='PENDING'&&<button type="button" className="ui-btn danger sm" onClick={()=>revoke.mutate(invite.id,{onSuccess:()=>toast.success('Convite revogado.'),onError:fail('Não foi possível revogar o convite.')})}>Revogar</button>}</div></li>)}</ul>}
  </>
}

function DepartmentsPanel(){
  const workspace=useWorkspace();const departments=useDepartments();const save=useSaveDepartment();const toast=useToast();const [error,setError]=useState('');
  async function create(event:FormEvent<HTMLFormElement>){event.preventDefault();setError('');const form=event.currentTarget;const data=new FormData(form);try{await save.mutateAsync({name:String(data.get('name')),description:String(data.get('description'))||undefined,color:String(data.get('color')),memberIds:[]});form.reset();toast.success('Fila criada.')}catch(failure){const message=describeApiError(failure,'Não foi possível criar a fila.');setError(message);toast.error(message)}}
  return <><h2>Filas e departamentos</h2><p className="ui-help">Organize o roteamento humano e associe membros às filas operacionais.</p>
    <form className="ui-form flush" onSubmit={create}>
      <label className="ui-field">Nome da fila<input name="name" required minLength={2} placeholder="Ex.: Comercial"/></label>
      <label className="ui-field">Descrição<input name="description" placeholder="Descrição da fila"/></label>
      <label className="ui-field">Cor<input name="color" type="color" defaultValue="#17765b"/></label>
      <FormAlert message={error}/>
      <div className="ui-actions"><button className="ui-btn primary" disabled={save.isPending}>Criar fila</button></div>
    </form>
    <h3>Filas</h3>
    {departments.isLoading?<LoadingState/>:departments.data?.length===0?<p className="ui-empty">Nenhuma fila ainda. Crie a primeira para rotear conversas para a equipe.</p>:<ul className="ui-rows dept-list">{departments.data?.map(department=><DepartmentCard key={department.id} department={department} members={workspace.data?.memberships??[]} save={save}/>)}</ul>}
  </>
}

function DepartmentCard({department,members,save}:{department:Department;members:WorkspaceMember[];save:ReturnType<typeof useSaveDepartment>}){
  const toast=useToast();const opts={onSuccess:()=>toast.success('Fila salva.'),onError:(failure:unknown)=>toast.error(describeApiError(failure,'Não foi possível salvar a fila.'))};
  const [memberIds,setMemberIds]=useState(department.members.map(item=>item.membership.id));const toggle=(id:string)=>setMemberIds(value=>value.includes(id)?value.filter(item=>item!==id):[...value,id]);
  return <li className={`dept-row${!department.isActive?' inactive':''}`}>
    <div className="dept-head"><i className="dept-swatch" style={{background:department.color}} aria-hidden="true"/><div className="grow"><b>{department.name}</b><small>{department.description||'Sem descrição'}{!department.isActive?' · Desativada':''}</small></div><div className="ui-row-actions"><button type="button" className={department.isActive?'ui-btn danger sm':'ui-btn sm'} onClick={()=>save.mutate({id:department.id,name:department.name,isActive:!department.isActive,memberIds},opts)}>{department.isActive?'Desativar':'Ativar'}</button></div></div>
    <div className="dept-members">{members.filter(member=>member.isActive).map(member=><label className="ui-check" key={member.id}><input type="checkbox" checked={memberIds.includes(member.id)} onChange={()=>toggle(member.id)}/>{member.user.name}</label>)}</div>
    <div className="dept-save"><button type="button" className="ui-btn sm" onClick={()=>save.mutate({id:department.id,name:department.name,memberIds},opts)}>Salvar membros</button></div>
  </li>
}

function HoursPanel(){
  const query=useBusinessHours();const save=useSaveBusinessHours();const toast=useToast();const [error,setError]=useState('');const [value,setValue]=useState<BusinessHours|null>(null);
  useEffect(()=>{if(query.data)setValue(query.data)},[query.data]);
  if(query.isLoading||!value)return <LoadingState/>;
  const names=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  return <><h2>Horários de atendimento</h2><p className="ui-help">Defina quando a equipe humana está disponível e a mensagem usada fora do expediente.</p>
    <div className="hours-list">{value.days.map((item,index)=><div key={item.day}><label className="ui-check"><input type="checkbox" checked={item.enabled} onChange={event=>setValue({...value,days:value.days.map((day,i)=>i===index?{...day,enabled:event.target.checked}:day)})}/>{names[item.day]}</label><input type="time" aria-label={`${names[item.day]}: abre às`} disabled={!item.enabled} value={item.open} onChange={event=>setValue({...value,days:value.days.map((day,i)=>i===index?{...day,open:event.target.value}:day)})}/><span>até</span><input type="time" aria-label={`${names[item.day]}: fecha às`} disabled={!item.enabled} value={item.close} onChange={event=>setValue({...value,days:value.days.map((day,i)=>i===index?{...day,close:event.target.value}:day)})}/></div>)}</div>
    <div className="ui-form">
      <label className="ui-field">Fuso horário<TimeZoneSelect value={value.timezone} onChange={zone=>setValue({...value,timezone:zone})}/></label>
      <label className="ui-field">Mensagem fora do horário<textarea rows={3} value={value.outsideMessage} onChange={event=>setValue({...value,outsideMessage:event.target.value})}/></label>
      <FormAlert message={error}/>
      <div className="ui-actions"><button type="button" className="ui-btn primary" disabled={save.isPending} onClick={()=>{setError('');const bad=value.days.find(day=>day.enabled&&day.open>=day.close);if(bad){const message=`${names[bad.day]}: o horário de abertura deve ser anterior ao fechamento.`;setError(message);toast.error(message);return}save.mutate(value,{onSuccess:()=>toast.success('Horários salvos.'),onError:failure=>{const message=describeApiError(failure,'Não foi possível salvar os horários.');setError(message);toast.error(message)}})}}>{save.isPending?'Salvando…':'Salvar horários'}</button></div>
    </div></>
}

function AuditPanel(){
  const [action,setAction]=useState('');const [cursors,setCursors]=useState(['']);const cursor=cursors.at(-1)??'';const audit=useAudit(action,cursor);
  return <><h2>Auditoria</h2><p className="ui-help">Histórico somente leitura das alterações sensíveis do workspace.</p>
    <div className="ui-search"><input type="search" aria-label="Filtrar por ação" placeholder="Filtrar por ação (ex.: kanban, disparo)" value={action} onChange={event=>{setAction(event.target.value);setCursors([''])}}/></div>
    {audit.isLoading?<LoadingState/>:audit.isError?<ErrorState error={audit.error} retry={()=>audit.refetch()}/>:<><div className="audit-table ui-table-wrap"><table className="ui-table"><thead><tr><th>Data</th><th>Ator</th><th>Ação</th><th>Alvo</th><th>IP</th></tr></thead><tbody>{audit.data?.items.map(item=><tr key={item.id}><td>{new Date(item.createdAt).toLocaleString('pt-BR')}</td><td>{item.actor?.name??'Sistema'}</td><td title={item.action}>{auditActionLabel(item.action)}</td><td>{item.targetType}{item.targetId?` · ${item.targetId.slice(0,8)}`:''}</td><td>{item.ip??'—'}</td></tr>)}</tbody></table></div>
    <div className="audit-pages"><button type="button" className="ui-btn sm" disabled={cursors.length===1} onClick={()=>setCursors(items=>items.slice(0,-1))}>Anterior</button><span>Página {cursors.length}</span><button type="button" className="ui-btn sm" disabled={!audit.data?.nextCursor} onClick={()=>audit.data?.nextCursor&&setCursors(items=>[...items,audit.data!.nextCursor!])}>Próxima</button></div></>}
  </>
}

function QuickRepliesPanel(){
  const toast=useToast();const [search,setSearch]=useState('');const query=useQuickReplies(search.trim());const save=useSaveQuickReply();const remove=useDeleteQuickReply();const [editing,setEditing]=useState<QuickReply|'new'|null>(null);const [removeAsset,setRemoveAsset]=useState(false);const [error,setError]=useState('');const current=editing&&editing!=='new'?editing:null;
  function edit(value:QuickReply|'new'){setRemoveAsset(false);setError('');setEditing(value)}
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setError('');const data=new FormData(event.currentTarget);try{const file=(data.get('media') as File|null);const asset=file?.size?await uploadPlaybookAsset(file):null;await save.mutateAsync({id:current?.id,shortcut:String(data.get('shortcut')),body:String(data.get('body')),assetId:asset?.id??(removeAsset?null:current?.asset?.id??null)});setEditing(null)}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível salvar a resposta.')}}
  async function del(item:QuickReply){if(!window.confirm(`Excluir /${item.shortcut}?`))return;try{await remove.mutateAsync(item.id);toast.success('Resposta excluída.')}catch(failure){toast.error(describeApiError(failure,'Não foi possível excluir a resposta.'))}}
  return <><h2>Respostas rápidas</h2><p className="ui-help">Digite o atalho no chat para inserir texto e mídia sem enviar automaticamente.</p>
    <div className="ui-search"><input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Buscar atalho ou conteúdo" aria-label="Buscar respostas rápidas"/></div>
    {query.isLoading?<LoadingState/>:query.isError?<ErrorState error={query.error} retry={()=>query.refetch()}/>:query.data?.length===0?<p className="ui-empty">{search.trim()?'Nenhuma resposta rápida encontrada.':'Nenhuma resposta rápida ainda. Crie uma para responder mais rápido no chat.'}</p>:<ul className="ui-rows">{query.data?.map(item=><li key={item.id}><div className="grow"><b>/{item.shortcut}</b><small>{item.body.slice(0,100)}</small>{item.asset&&<small>Anexo: {item.asset.fileName} · {item.asset.contentType} · {Math.ceil(item.asset.size/1024)} KB</small>}</div><div className="ui-row-actions"><button type="button" className="ui-btn quiet sm" onClick={()=>edit(item)}>Editar</button><button type="button" className="ui-btn danger sm" onClick={()=>void del(item)}>Excluir</button></div></li>)}</ul>}
    {!editing&&<button type="button" className="ui-btn primary" onClick={()=>edit('new')}><Plus size={16} aria-hidden="true"/> Criar resposta rápida</button>}
    {editing&&<form className="ui-form" onSubmit={submit} key={current?.id??'new'}>
      <h3>{current?`Editar /${current.shortcut}`:'Nova resposta rápida'}</h3>
      <label className="ui-field">Atalho<input name="shortcut" required minLength={2} maxLength={40} defaultValue={current?.shortcut} placeholder="pix"/></label>
      <label className="ui-field">Mensagem<textarea name="body" required rows={6} maxLength={4096} defaultValue={current?.body}/></label>
      <label className="ui-field">Mídia opcional<input name="media" type="file" accept="image/*,audio/*,video/*,.pdf"/><small>{current?.asset?`Atual: ${current.asset.fileName}. Selecione outro para substituir.`:'Até 10 MB.'}</small></label>
      {current?.asset&&!removeAsset&&<QuickAssetPreview asset={current.asset}/>}
      {current?.asset&&<label className="ui-check"><input type="checkbox" checked={removeAsset} onChange={event=>setRemoveAsset(event.target.checked)}/> Remover mídia atual ao salvar</label>}
      {error&&<p className="ui-alert" role="alert">{error}</p>}
      <div className="ui-actions"><button className="ui-btn primary" disabled={save.isPending}>{save.isPending?'Salvando…':'Salvar'}</button><button type="button" className="ui-btn quiet" onClick={()=>setEditing(null)}>Cancelar</button></div>
    </form>}
  </>
}

function QuickAssetPreview({asset}:{asset:NonNullable<QuickReply['asset']>}){const [url,setUrl]=useState('');const [error,setError]=useState('');useEffect(()=>{let alive=true;let objectUrl='';apiBlob(`/v1/playbook-assets/${asset.id}`).then(blob=>{if(!alive)return;objectUrl=URL.createObjectURL(blob);setUrl(objectUrl)}).catch(reason=>alive&&setError(reason instanceof Error?reason.message:'Falha ao carregar mídia.'));return()=>{alive=false;if(objectUrl)URL.revokeObjectURL(objectUrl)}},[asset.id]);if(error)return <small className="ui-alert">{error}</small>;if(!url)return <small>Carregando pré-visualização…</small>;if(asset.contentType.startsWith('image/'))return <img className="quick-media-preview" src={url} alt={asset.fileName}/>;if(asset.contentType.startsWith('audio/'))return <audio className="quick-media-preview" src={url} controls/>;if(asset.contentType.startsWith('video/'))return <video className="quick-media-preview" src={url} controls/>;return <a href={url} target="_blank" rel="noreferrer">Abrir {asset.fileName}</a>}

function GlobalVariablesPanel(){
  const query=useGlobalVariables();
  const save=useSaveGlobalVariable();
  const remove=useDeleteGlobalVariable();
  const [editing,setEditing]=useState<GlobalVariable|'new'|null>(null);
  const [error,setError]=useState('');
  const current=editing&&editing!=='new'?editing:null;
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setError('');const data=new FormData(event.currentTarget);try{await save.mutateAsync({id:current?.id,name:String(data.get('name')),value:String(data.get('value')),sensitive:data.get('sensitive')==='on'});setEditing(null)}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível salvar a variável.')}}
  async function del(item:GlobalVariable){
    setError('');
    try{await remove.mutateAsync({id:item.id});return}catch(reason){
      if(reason instanceof ApiError&&reason.code==='VARIABLE_IN_USE'){
        const references=typeof reason.details==='object'&&reason.details&&'references'in reason.details?Number((reason.details as {references:unknown}).references):0;
        if(!window.confirm(`global.${item.name} aparece em ${references} versão(ões) ativa(s). Excluir mesmo assim?`))return;
        try{await remove.mutateAsync({id:item.id,confirm:true});return}catch(confirmedReason){setError(confirmedReason instanceof Error?confirmedReason.message:'Não foi possível excluir a variável.');return}
      }
      setError(reason instanceof Error?reason.message:'Não foi possível excluir a variável.');
    }
  }
  return <><h2>Variáveis globais</h2><p className="ui-help">Use <code>{'{{global.nome}}'}</code> nos blocos. Todos os valores são cifrados; sensíveis nunca voltam pela API.</p>
    {query.isLoading?<LoadingState/>:query.isError?<ErrorState error={query.error} retry={()=>query.refetch()}/>:query.data?.length===0?<p className="ui-empty">Nenhuma variável global ainda. Crie uma para reutilizar um valor em vários fluxos.</p>:<ul className="ui-rows">{query.data?.map(item=><li key={item.id}><div className="grow"><b>global.{item.name}</b><small>{item.sensitive?`Valor sensível ••••${item.valueLast4??''}`:item.value??'Valor indisponível'}</small></div><div className="ui-row-actions"><button type="button" className="ui-btn quiet sm" onClick={()=>setEditing(item)}>Trocar valor</button><button type="button" className="ui-btn danger sm" onClick={()=>void del(item)}>Excluir</button></div></li>)}</ul>}
    {!editing&&error&&<p className="ui-alert" role="alert">{error}</p>}
    {!editing&&<button type="button" className="ui-btn primary" onClick={()=>setEditing('new')}><Plus size={16} aria-hidden="true"/> Criar variável global</button>}
    {editing&&<form className="ui-form" onSubmit={submit} key={current?.id??'new'}>
      <h3>{current?`Trocar valor de global.${current.name}`:'Nova variável global'}</h3>
      <label className="ui-field">Nome<input name="name" required minLength={2} maxLength={60} defaultValue={current?.name} placeholder="link_grupo" pattern="[a-z][a-z0-9_]*"/></label>
      <label className="ui-field">{current?'Novo valor':'Valor'}<input name="value" type={current?.sensitive?'password':'text'} required maxLength={8192} autoComplete="off" defaultValue={current?.sensitive?'':current?.value}/></label>
      <label className="ui-check"><input name="sensitive" type="checkbox" defaultChecked={current?.sensitive}/> Valor sensível</label>
      {error&&<p className="ui-alert" role="alert">{error}</p>}
      <div className="ui-actions"><button className="ui-btn primary" disabled={save.isPending}>{save.isPending?'Salvando…':'Salvar cifrada'}</button><button type="button" className="ui-btn quiet" onClick={()=>setEditing(null)}>Cancelar</button></div>
    </form>}
  </>;
}

function statusLabel(status:string){return ({CONNECTED:'Conectado',PENDING:'Aguardando conexão',DEGRADED:'Reconectando',DISCONNECTED:'Desconectado'} as Record<string,string>)[status]??status}
function statusTone(status:string){return status==='CONNECTED'?'on':status==='DEGRADED'||status==='PENDING'?'warn':''}

function PixelsPanel(){
  const pixels=useMetaPixels();const save=useSaveMetaPixel();const remove=useDeleteMetaPixel();const [editing,setEditing]=useState<MetaPixel|'new'|null>(null);const [error,setError]=useState('');
  const current=editing&&editing!=='new'?editing:null;const [form,setForm]=useState({name:'',pixelId:'',accessToken:'',pageId:'',testEventCode:''});
  function open(pixel:MetaPixel|'new'){setError('');setEditing(pixel);setForm(pixel==='new'?{name:'',pixelId:'',accessToken:'',pageId:'',testEventCode:''}:{name:pixel.name,pixelId:pixel.pixelId,accessToken:'',pageId:pixel.pageId??'',testEventCode:pixel.testEventCode??''})}
  async function submit(event:FormEvent){event.preventDefault();setError('');if(!form.name.trim()||!form.pixelId.trim()){setError('Informe o nome e o ID do pixel.');return}if(!current&&!form.accessToken.trim()){setError('Informe o token de acesso.');return}try{await save.mutateAsync({id:current?.id,name:form.name.trim(),pixelId:form.pixelId.trim(),...(form.accessToken.trim()?{accessToken:form.accessToken.trim()}:{}),pageId:form.pageId.trim()||null,testEventCode:form.testEventCode.trim()||null});setForm(value=>({...value,accessToken:''}));save.reset();setEditing(null)}catch(err){setError(err instanceof Error?err.message:'Não foi possível salvar o pixel.')}}
  async function del(pixel:MetaPixel){if(!window.confirm(`Excluir o pixel "${pixel.name}"? Blocos que o usam deixarão de enviar eventos.`))return;setError('');try{await remove.mutateAsync(pixel.id)}catch(err){setError(err instanceof Error?err.message:'Não foi possível excluir o pixel.')}}
  const set=(key:keyof typeof form)=>(event:{target:{value:string}})=>setForm(value=>({...value,[key]:event.target.value}));
  return <><h2>Pixels do Facebook</h2><p className="ui-help">Usados pelos Blocos de Pixel para enviar eventos pela API de Conversões. O token é cifrado e nunca é exibido de novo.</p>
    {pixels.isLoading?<LoadingState/>:pixels.isError?<ErrorState error={pixels.error} retry={()=>pixels.refetch()}/>:pixels.data?.length===0?<p className="ui-empty"><b>Nenhum pixel ainda.</b>Adicione o ID e o token do seu pixel.</p>:<ul className="ui-rows">{pixels.data?.map(pixel=><li key={pixel.id}><div className="grow"><b>{pixel.name}</b><small>ID {pixel.pixelId} · token termina em {pixel.tokenLast4}{pixel.testEventCode?' · com código de teste':''}</small></div><div className="ui-row-actions"><button type="button" className="ui-btn quiet sm" onClick={()=>open(pixel)}>Editar</button><button type="button" className="ui-btn danger sm" onClick={()=>void del(pixel)} disabled={remove.isPending}>Excluir</button></div></li>)}</ul>}
    {!editing&&<button className="ui-btn primary" type="button" onClick={()=>open('new')}><Plus size={16} aria-hidden="true"/> Adicionar pixel</button>}
    {editing&&<form className="ui-form" onSubmit={submit}>
      <h3>{current?'Editar pixel':'Novo pixel'}</h3>
      <label className="ui-field">Nome<input value={form.name} onChange={set('name')} maxLength={80}/></label>
      <label className="ui-field">ID do pixel<input value={form.pixelId} onChange={set('pixelId')} inputMode="numeric" placeholder="123456789012345"/></label>
      <label className="ui-field">Token de acesso<input type="password" autoComplete="off" value={form.accessToken} onChange={set('accessToken')} placeholder={current?`Em branco mantém o atual (termina em ${current.tokenLast4})`:'EAAB...'}/></label>
      <label className="ui-field">Page ID padrão (opcional)<input value={form.pageId} onChange={set('pageId')}/></label>
      <label className="ui-field">Código de evento de teste (opcional)<input value={form.testEventCode} onChange={set('testEventCode')} placeholder="TEST12345"/></label>
      {error&&<p className="ui-alert" role="alert">{error}</p>}
      <div className="ui-actions"><button className="ui-btn primary" disabled={save.isPending}>{current?'Salvar alterações':'Adicionar pixel'}</button><button type="button" className="ui-btn quiet" onClick={()=>setEditing(null)}>Cancelar</button></div>
    </form>}
    {!editing&&error&&<p className="ui-alert" role="alert">{error}</p>}
  </>
}

function AiKeyPanel(){
  const toast=useToast();const key=useWorkspaceAiKey();const save=useSaveAiKey();const remove=useDeleteAiKey();const [value,setValue]=useState('');const [error,setError]=useState('');const [replacing,setReplacing]=useState(false);
  async function submit(event:FormEvent){event.preventDefault();setError('');if(!value.trim().startsWith('sk-')){setError('A chave da OpenAI começa com sk-.');return}try{await save.mutateAsync(value.trim());setValue('');setReplacing(false);toast.success('Chave salva.')}catch(failure){const message=describeApiError(failure,'Não foi possível salvar a chave.');setError(message);toast.error(message)}}
  const configured=Boolean(key.data?.configured);const showForm=!configured||replacing;
  return <><h2>Chave da OpenAI</h2><p className="ui-help">Usada pelos Blocos de IA dos fluxos. Fica guardada cifrada e nunca é exibida de novo.</p>
    {key.isLoading?<LoadingState lines={1}/>:key.isError?<ErrorState error={key.error} retry={()=>key.refetch()}/>:configured?<ul className="ui-rows"><li><div className="grow"><b>Chave salva, termina em {key.data?.last4}</b><small>Os Blocos de IA já podem usá-la.</small></div><div className="ui-row-actions">{!replacing&&<button type="button" className="ui-btn quiet sm" onClick={()=>{setReplacing(true);setError('')}}>Trocar</button>}<button type="button" className="ui-btn danger sm" onClick={()=>void remove.mutateAsync().then(()=>{setReplacing(false);toast.success('Chave removida.')},failure=>toast.error(describeApiError(failure,'Não foi possível remover a chave.')))} disabled={remove.isPending}>Remover chave</button></div></li></ul>:<p className="ui-empty"><b>Nenhuma chave salva.</b>Cole abaixo a chave da sua conta OpenAI para ativar os Blocos de IA.</p>}
    {showForm&&!key.isLoading&&<form className="ui-form" onSubmit={submit}>
      <label className="ui-field">{configured?'Nova chave':'Chave da OpenAI'}<input type="password" autoComplete="off" value={value} onChange={event=>setValue(event.target.value)} placeholder="sk-..." aria-invalid={Boolean(error)||undefined}/></label>
      {error&&<p className="ui-alert" role="alert">{error}</p>}
      <div className="ui-actions"><button className="ui-btn primary" disabled={save.isPending||!value.trim()}>Salvar chave</button>{configured&&<button type="button" className="ui-btn quiet" onClick={()=>{setReplacing(false);setValue('');setError('')}}>Cancelar</button>}</div>
    </form>}
  </>
}
