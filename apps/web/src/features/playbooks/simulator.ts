// Pure helpers for the chat simulator panel. Types mirror apps/api simulation routes (web imports no values from contracts).
export type SimOption={id:string;title?:string;label?:string;description?:string;[key:string]:unknown};
export type SimMessage={id:string;role:'bot'|'contact'|'system';nodeId:string|null;kind:'text'|'media'|'menu'|'simulated'|'delay'|'end'|'error';text:string|null;mediaUrl?:string|null;options?:SimOption[];detail?:string;at:string};
export type SimWait={kind:'choice';nodeId:string;options:SimOption[];canTimeout:boolean}|{kind:'reply';nodeId:string;canTimeout:boolean}|{kind:'delay';nodeId:string;resumeAt:string|null}|{kind:'port';nodeId:string;ports:Array<'success'|'failure'|'reply'|'timeout'>};
export type SimView={messages:SimMessage[];activeNodeId:string|null;visitedNodeIds:string[];waiting:SimWait|null;completed:boolean;error?:{code:string;message:string;nodeId:string|null}};
export type SimPort='success'|'failure'|'reply'|'timeout';
export const SIM_MAX_STEPS=200;
export const SIM_MAX_MESSAGES=100;
export const SIM_MAX_SESSIONS=5;
export const SIM_PANEL_MIN=320;
export const SIM_PANEL_MAX=640;
export const SIM_PANEL_DEFAULT=380;
export const LIVE_CONFIRM_TEXT='Executar IA e Integração de verdade chama serviços externos com as credenciais do workspace e pode gerar custo. Nenhuma mensagem real é enviada e nenhum contato é alterado. Confirmar para esta sessão?';

export const optionLabel=(option:SimOption)=>String(option.title??option.label??option.id);
/** The composer takes typed text only while the flow waits for a reply or a menu choice (typing also works as a menu answer). */
export const composerEnabled=(view:SimView|null)=>Boolean(view&&!view.completed&&!view.error&&(view.waiting?.kind==='reply'||view.waiting?.kind==='choice'));
export type SkipAction={label:string}|null;
export function skipAction(view:SimView|null):SkipAction{
  const wait=view?.waiting;if(!view||!wait||view.completed||view.error)return null;
  if(wait.kind==='delay')return {label:'Pular espera'};
  if((wait.kind==='reply'||wait.kind==='choice')&&wait.canTimeout)return {label:'Pular para "não respondeu"'};
  return null;
}
/** Simulated Integração/IA blocks wait for the user to pick the outcome unless live actions are on. */
export const portChoices=(view:SimView|null)=>view?.waiting?.kind==='port'&&!view.completed&&!view.error?{nodeId:view.waiting.nodeId,ports:view.waiting.ports.filter(port=>port==='success'||port==='failure')}:null;
export const PORT_LABEL:Record<string,string>={success:'Sucesso',failure:'Falha'};
export function endReason(view:SimView|null){
  if(!view)return null;
  if(view.error)return {tone:'error' as const,text:view.error.message,nodeId:view.error.nodeId};
  if(view.completed){const last=[...view.messages].reverse().find(m=>m.kind==='end');return {tone:'end' as const,text:last?.text??last?.detail??'O fluxo terminou.',nodeId:null}}
  return null;
}
export const limitWarning=(view:SimView|null)=>view&&view.messages.length>=SIM_MAX_MESSAGES*0.9&&!view.completed?`A sessão está perto do limite de ${SIM_MAX_MESSAGES} mensagens. Reinicie para continuar testando.`:null;
export function parseVariables(text:string):{ok:true;value:Record<string,unknown>}|{ok:false}{
  try{const parsed:unknown=JSON.parse(text.trim()||'{}');if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')return {ok:false};return {ok:true,value:parsed as Record<string,unknown>}}catch{return {ok:false}}
}
type ErrorLike={status?:number;code?:string;message?:string};
export function simulatorError(error:unknown):{kind:'expired'|'limit'|'confirm'|'other';text:string}{
  const e=(error&&typeof error==='object'?error:{}) as ErrorLike;
  if(e.code==='SIMULATION_EXPIRED')return {kind:'expired',text:'A sessão do simulador expirou. Reinicie para continuar.'};
  if(e.code==='SIMULATION_LIMIT')return {kind:'limit',text:`Você já tem ${SIM_MAX_SESSIONS} simulações abertas. Feche ou reinicie uma sessão (em outra aba do editor, ou aguarde a expiração em 30 minutos) e tente de novo.`};
  if(e.code==='LIVE_ACTIONS_CONFIRMATION_REQUIRED')return {kind:'confirm',text:'Confirme a execução real para iniciar esta sessão.'};
  return {kind:'other',text:e.message||'Não foi possível concluir a simulação. Tente novamente.'};
}
/** Trace shown on the canvas. Derived from the session, never from editor state, so it cannot dirty the flow. */
export type SimTrace={activeNodeId:string|null;visited:ReadonlySet<string>};
export const traceOf=(view:SimView|null):SimTrace|null=>view?{activeNodeId:view.activeNodeId,visited:new Set(view.visitedNodeIds)}:null;
export function traceClass(trace:SimTrace|null,nodeId:string,base?:string){
  if(!trace)return base;
  const extra=trace.activeNodeId===nodeId?'sim-active':trace.visited.has(nodeId)?'sim-visited':'';
  return [base,extra].filter(Boolean).join(' ')||undefined;
}
export const clampPanelWidth=(width:number,viewport:number)=>Math.round(Math.min(SIM_PANEL_MAX,Math.max(SIM_PANEL_MIN,Math.min(width,viewport-80))));
