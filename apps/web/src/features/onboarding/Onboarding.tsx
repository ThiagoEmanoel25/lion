import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {useSession} from '../../app/providers/SessionProvider';
import {APP_NAME} from '../../shared/brand';
import {useChannels} from '../settings/api/queries';
import {usePlaybooks} from '../playbooks/api/queries';
import {useContacts} from '../contacts/api/queries';
import {useAgents,useProviderStatus} from '../agents/api/queries';
import {buildChecklist,summarize} from './progress';
import {readOnboarding,writeOnboarding,type OnboardingState} from './state';
import './onboarding.css';

const steps=[
  {title:`Bem-vindo ao ${APP_NAME}`,text:`O ${APP_NAME} reúne atendimento, automação e IA no WhatsApp para suas conversas avançarem até o resultado.`},
  {title:'Chats ao vivo',text:'Na caixa de entrada você acompanha cada conversa, assume do robô quando quiser e responde com a sua equipe.'},
  {title:'Fluxos',text:'Monte fluxos visuais que respondem, qualificam e encaminham contatos automaticamente. Publique quando estiver pronto.'},
  {title:'Agentes de IA',text:'Conecte sua chave de IA e crie agentes que atendem com a base de conhecimento da sua empresa.'}
];
const focusable='button:not([disabled]),a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';

function WelcomeModal({onClose}:{onClose:()=>void}){
  const [index,setIndex]=useState(0);
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return()=>previous?.focus?.();
  },[]);
  // Ao trocar de passo o botão focado pode ser desmontado (ex.: Voltar no passo 1); sem isso o foco cai no body e o Esc para de funcionar.
  useEffect(()=>{ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()},[index]);
  const last=index===steps.length-1;
  const onKey=(event:React.KeyboardEvent)=>{
    if(event.key==='Escape'){event.stopPropagation();onClose();return}
    if(event.key!=='Tab')return;
    const nodes=[...ref.current?.querySelectorAll<HTMLElement>(focusable)??[]];
    if(!nodes.length)return;
    const first=nodes[0],end=nodes[nodes.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();end.focus()}
    else if(!event.shiftKey&&document.activeElement===end){event.preventDefault();first.focus()}
  };
  const step=steps[index];
  return <div className="onb-backdrop" onKeyDown={onKey}>
    <div className="onb-modal" role="dialog" aria-modal="true" aria-labelledby="onb-title" aria-describedby="onb-text" ref={ref}>
      <small className="onb-step">Passo {index+1} de {steps.length}</small>
      <h2 id="onb-title">{step.title}</h2>
      <p id="onb-text">{step.text}</p>
      <div className="onb-dots" aria-hidden="true">{steps.map((_,i)=><i key={i} className={i===index?'on':''}/>)}</div>
      <footer>
        <button type="button" className="onb-link" onClick={onClose}>Pular</button>
        <span>
          {index>0&&<button type="button" className="onb-secondary" onClick={()=>setIndex(index-1)}>Voltar</button>}
          <button type="button" className="onb-primary" data-autofocus key={last?'done':'next'} onClick={()=>last?onClose():setIndex(index+1)}>{last?'Começar':'Avançar'}</button>
        </span>
      </footer>
    </div>
  </div>
}

export function Onboarding(){
  const {session}=useSession();
  const workspaceId=session?.workspace.id??'';
  const userId=session?.user.id??'';
  const [params,setParams]=useSearchParams();
  const [state,setState]=useState<OnboardingState>(()=>readOnboarding(workspaceId,userId));
  const [forceOpen,setForceOpen]=useState(false);
  useEffect(()=>{setState(readOnboarding(workspaceId,userId))},[workspaceId,userId]);
  const update=useCallback((patch:Partial<OnboardingState>)=>{setState(current=>{const next={...current,...patch};writeOnboarding(workspaceId,userId,next);return next})},[workspaceId,userId]);
  // "Rever tutorial" no menu navega para /?tutorial=1
  useEffect(()=>{
    if(params.get('tutorial')!=='1')return;
    setForceOpen(true);update({dismissed:false});
    const next=new URLSearchParams(params);next.delete('tutorial');setParams(next,{replace:true});
  },[params,setParams,update]);
  const channels=useChannels(),playbooks=usePlaybooks(),contacts=useContacts({}),agents=useAgents(),providers=useProviderStatus();
  const items=useMemo(()=>buildChecklist({channels:channels.data,playbooks:playbooks.data,contactCount:contacts.data?.items.length,agents:agents.data,providers:providers.data?.providers}),[channels.data,playbooks.data,contacts.data,agents.data,providers.data]);
  const summary=summarize(items);
  const nextId=items.find(item=>!item.done)?.id;
  if(!workspaceId||!userId)return null;
  const showWelcome=forceOpen||!state.welcomeSeen;
  const closeWelcome=()=>{setForceOpen(false);update({welcomeSeen:true})};
  return <>
    {showWelcome&&<WelcomeModal onClose={closeWelcome}/>}
    {!state.dismissed&&<section className="onb-card" aria-labelledby="onb-check-title">
      <header>
        <div><h2 id="onb-check-title">Primeiros passos</h2><p>{summary.complete?`Tudo pronto! O ${APP_NAME} está configurado.`:`Configure o ${APP_NAME} em poucos passos.`}</p></div>
        <div className="onb-actions"><button type="button" className="onb-link" onClick={()=>setForceOpen(true)}>Rever tutorial</button><button type="button" className="onb-link" onClick={()=>update({dismissed:true})}>Dispensar</button></div>
      </header>
      <div className="onb-progress"><div role="progressbar" aria-label="Progresso dos primeiros passos" aria-valuemin={0} aria-valuemax={100} aria-valuenow={summary.percent}><u style={{width:`${summary.percent}%`}}/></div><b>{summary.done} de {summary.total}</b></div>
      <ul>{items.map(item=>{const next=!item.done&&item.id===nextId;return <li key={item.id} className={item.done?'done':next?'next':''} data-done={item.done}>
        <span className="onb-check" aria-hidden="true">{item.done?'✓':''}</span>
        <div><b>{item.title}</b>{!item.done&&<small>{item.description}</small>}</div>
        {item.done?<em>Concluído</em>:next?<Link className="onb-cta" to={item.to}>{item.cta}</Link>:null}
      </li>})}</ul>
    </section>}
    {state.dismissed&&<button type="button" className="onb-reopen" onClick={()=>update({dismissed:false})}>Mostrar primeiros passos</button>}
  </>
}
