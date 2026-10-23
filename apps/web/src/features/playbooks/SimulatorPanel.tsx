import {useCallback,useEffect,useRef,useState,type KeyboardEvent,type PointerEvent} from 'react';
import {ChevronDown,ChevronUp,FastForward,RotateCcw,Send,X} from 'lucide-react';
import type {AutomationDefinition} from '../../shared/types/api';
import {advanceSimulation,closeSimulation,createSimulation,restartSimulation,sendSimulation} from './api/queries';
import {LIVE_CONFIRM_TEXT,PORT_LABEL,SIM_PANEL_DEFAULT,clampPanelWidth,composerEnabled,endReason,limitWarning,optionLabel,parseVariables,portChoices,simulatorError,skipAction,type SimPort,type SimView} from './simulator';

type Props={playbookId:string;definition:AutomationDefinition;variablesText:string;onVariablesText:(value:string)=>void;onView:(view:SimView|null)=>void;onFocusNode:(nodeId:string)=>void;onClose:()=>void};

export function SimulatorPanel({playbookId,definition,variablesText,onVariablesText,onView,onFocusNode,onClose}:Props){
  const [view,setView]=useState<SimView|null>(null);const [busy,setBusy]=useState(false);const [problem,setProblem]=useState<{kind:string;text:string}|null>(null);const [text,setText]=useState('');
  const [advanced,setAdvanced]=useState(false);const [live,setLive]=useState(false);const [liveSession,setLiveSession]=useState(false);const [width,setWidth]=useState(SIM_PANEL_DEFAULT);
  const session=useRef<{id:string;key:string}|null>(null);const started=useRef(false);const endRef=useRef<HTMLDivElement>(null);
  const keyOf=()=>JSON.stringify([definition,variablesText.trim()]);
  const show=useCallback((next:SimView|null)=>{setView(next);onView(next)},[onView]);
  const fail=(error:unknown)=>{const info=simulatorError(error);setProblem(info);if(info.kind==='expired')session.current=null};
  const drop=useCallback(()=>{const current=session.current;session.current=null;if(current)closeSimulation(playbookId,current.id).catch(()=>{})},[playbookId]);
  const start=useCallback(async()=>{
    const parsed=parseVariables(variablesText);if(!parsed.ok){setAdvanced(true);setProblem({kind:'other',text:'As variáveis iniciais precisam ser um objeto JSON válido.'});return}
    setBusy(true);setProblem(null);drop();
    try{const created=await createSimulation(playbookId,{definition,variables:parsed.value,liveActions:live,confirmLiveActions:live});session.current={id:created.simulationId,key:JSON.stringify([definition,variablesText.trim()])};setLiveSession(live);setLive(false);/* confirmation is per session: the next session needs a new confirm */show(created)}catch(error){fail(error)}finally{setBusy(false)}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[playbookId,definition,variablesText,live,drop,show]);
  useEffect(()=>{if(started.current)return;started.current=true;void start()},[start]);
  useEffect(()=>()=>{drop();onView(null)},[drop,onView]);
  useEffect(()=>{endRef.current?.scrollIntoView({block:'end'})},[view?.messages.length,problem]);
  async function run(call:(id:string)=>Promise<SimView>){const current=session.current;if(!current){await start();return}setBusy(true);setProblem(null);try{show(await call(current.id))}catch(error){fail(error)}finally{setBusy(false)}}
  async function restart(){const current=session.current;if(!current||live||current.key!==keyOf()){await start();return}await run(id=>restartSimulation(playbookId,id))}
  function submit(){const value=text.trim();if(!value||busy||!composerEnabled(view))return;setText('');void run(id=>sendSimulation(playbookId,id,{text:value}))}
  const choose=(optionId:string)=>run(id=>sendSimulation(playbookId,id,{optionId}));
  const pick=(nodeId:string,port:SimPort)=>run(id=>sendSimulation(playbookId,id,{port:{nodeId,port}}));
  function toggleLive(on:boolean){if(on&&!window.confirm(LIVE_CONFIRM_TEXT))return;setLive(on)}
  function resize(event:PointerEvent<HTMLDivElement>){if(!(event.buttons&1))return;setWidth(clampPanelWidth(window.innerWidth-event.clientX-15,window.innerWidth))}
  function resizeKey(event:KeyboardEvent){if(event.key==='ArrowLeft')setWidth(w=>clampPanelWidth(w+24,window.innerWidth));if(event.key==='ArrowRight')setWidth(w=>clampPanelWidth(w-24,window.innerWidth))}
  const ended=endReason(view);const skip=skipAction(view);const ports=portChoices(view);const warn=limitWarning(view);const enabled=composerEnabled(view)&&!busy;
  const staleLive=live;const changed=Boolean(session.current)&&session.current?.key!==keyOf();
  return <aside className="sim-panel" style={{width}} aria-label="Simulador do fluxo">
    <div className="sim-resize" role="separator" aria-orientation="vertical" aria-label="Redimensionar simulador" tabIndex={0} onPointerDown={event=>event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={resize} onKeyDown={resizeKey}/>
    <header className="sim-head"><div><small>SIMULADOR</small><b>Conversa de teste</b></div><button type="button" onClick={()=>void restart()} disabled={busy} title="Reiniciar"><RotateCcw size={15} aria-hidden="true"/> Reiniciar</button><button type="button" className="sim-close" onClick={onClose} aria-label="Fechar simulador"><X size={17} aria-hidden="true"/></button></header>
    {liveSession&&<div className="sim-live">Execução real ligada: IA e Integração rodam de verdade e podem gerar custo.</div>}
    <div className="sim-chat" role="log" aria-live="polite">
      {!view&&!problem&&<p className="sim-empty">Iniciando a conversa…</p>}
      {view?.messages.map(message=>message.kind==='end'?null:<div key={message.id} className={`sim-msg ${message.role} ${message.kind}`} onClick={()=>message.nodeId&&onFocusNode(message.nodeId)}>{(message.kind==='simulated'||message.kind==='delay'||message.kind==='error')&&<small>{message.kind==='delay'?'Espera':message.kind==='error'?'Erro':'Simulado'}</small>}{message.mediaUrl&&<em>[mídia] {message.mediaUrl}</em>}{message.text&&<span>{message.text}</span>}{message.detail&&<em>{message.detail}</em>}</div>)}
      {view?.waiting?.kind==='choice'&&!view.completed&&<div className="sim-options">{view.waiting.options.map(option=><button type="button" key={option.id} disabled={busy} onClick={()=>void choose(option.id)}>{optionLabel(option)}</button>)}</div>}
      {ports&&<div className="sim-ports"><small>Bloco simulado. Escolha o resultado:</small><div>{ports.ports.map(port=><button type="button" key={port} disabled={busy} onClick={()=>void pick(ports.nodeId,port)}>{PORT_LABEL[port]}</button>)}</div></div>}
      {ended&&<div className={`sim-end ${ended.tone}`}><b>{ended.tone==='error'?'A simulação parou':'Fim do fluxo'}</b><span>{ended.text}</span>{ended.nodeId&&<button type="button" onClick={()=>onFocusNode(ended.nodeId!)}>Ver bloco no canvas</button>}</div>}
      {warn&&<div className="sim-note">{warn}</div>}
      {problem&&<div className={`sim-end error ${problem.kind}`} role="alert"><span>{problem.text}</span>{problem.kind==='expired'&&<button type="button" onClick={()=>void start()}>Reiniciar</button>}</div>}
      <div ref={endRef}/>
    </div>
    {skip&&<div className="sim-skip"><button type="button" disabled={busy} onClick={()=>void run(id=>advanceSimulation(playbookId,id))}><FastForward size={14} aria-hidden="true"/> {skip.label}</button></div>}
    {changed&&!staleLive&&<div className="sim-note">O fluxo ou as opções mudaram. Reiniciar começa uma conversa nova com eles.</div>}
    {staleLive&&<div className="sim-note">Execução real confirmada para a próxima sessão. Vale a partir de Reiniciar.</div>}
    <form className="sim-composer" onSubmit={event=>{event.preventDefault();submit()}}><input value={text} onChange={event=>setText(event.target.value)} disabled={!enabled} placeholder={enabled?'Digite como o cliente…':view?.completed?'Conversa encerrada':'Aguardando o fluxo…'} aria-label="Mensagem do cliente" maxLength={4096}/><button type="submit" disabled={!enabled||!text.trim()} aria-label="Enviar"><Send size={16} aria-hidden="true"/></button></form>
    <div className="sim-advanced"><button type="button" aria-expanded={advanced} onClick={()=>setAdvanced(value=>!value)}>Avançado {advanced?<ChevronUp size={14} aria-hidden="true"/>:<ChevronDown size={14} aria-hidden="true"/>}</button>
      {advanced&&<div><label>Variáveis iniciais (JSON)<textarea rows={4} spellCheck={false} value={variablesText} onChange={event=>onVariablesText(event.target.value)} placeholder={'{"contact":{"stage":"qualified"}}'}/><small>Usadas em condições e textos. Vale a partir de Reiniciar.</small></label><p className="sim-hint">Blocos de Integração e IA aparecem no chat com os botões Sucesso e Falha para você escolher a saída.</p><label className="check-field"><input type="checkbox" checked={live} onChange={event=>toggleLive(event.target.checked)}/> Executar IA e Integração de verdade</label><small>Desligado por padrão. Pixel, WhatsApp, Venda e Notificação nunca executam. Pede confirmação a cada ativação.</small></div>}
    </div>
  </aside>;
}
