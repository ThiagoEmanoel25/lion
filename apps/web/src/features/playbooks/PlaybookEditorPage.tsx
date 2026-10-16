import {useCallback,useEffect,useMemo,useRef,useState,type DragEvent} from 'react';
import {Link,useParams} from 'react-router-dom';
import {Background,Controls,Handle,MarkerType,MiniMap,Position,ReactFlow,addEdge,applyEdgeChanges,applyNodeChanges,type Connection,type Edge,type EdgeChange,type Node,type NodeChange,type NodeProps,type ReactFlowInstance} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {Blocks,Bold,Bot,Building2,ChevronDown,ChevronLeft,ChevronUp,CircleCheck,Clock,Code,Columns3,GitBranch,Headset,Hourglass,Image,Italic,List,MessageSquare,Mic,Play,Plus,Search,Smile,Sparkles,Square,Sticker,Strikethrough,Tag,Webhook,X,Zap,type LucideIcon} from 'lucide-react';
import {ApiError} from '../../shared/api/client';
import type {AutomationDefinition,AutomationEdge,AutomationNodeKind,AutomationValidation,KanbanBoard,PlaybookVersion} from '../../shared/types/api';
import {usePlaybook,usePublishPlaybook,useSavePlaybookVersion,useSimulatePlaybook,useValidatePlaybook} from './api/queries';
import {useAgents} from '../agents/api/queries';
import {useWorkspaceAiKey} from '../settings/api/queries';
import {useContactMeta} from '../contacts/api/queries';
import {useKanbanBoards} from '../kanban/api/queries';
import type {AiAgent,ContactMeta} from '../../shared/types/api';
import {CONDITION_GROUPS,coerceRuleValue,CUSTOM_FIELD_PREFIX,WEEKDAY_LABELS,itemForRule,ruleError,searchConditionItems,valueKind,type ConditionOperator,type ConditionRule} from './condition-catalog';
import './flow-builder.css';

type FlowNodeData={kind:AutomationNodeKind;name:string;config:Record<string,unknown>};
type FlowNode=Node<FlowNodeData,'automation'>;
type FlowEdgeData={condition?:AutomationEdge['condition'];isDefault?:boolean;priority?:number;port?:AutomationEdge['port']};
type FlowEdge=Edge<FlowEdgeData>;

const catalog:Array<{kind:AutomationNodeKind;icon:LucideIcon;label:string;description:string;rule:string}>=[
  {kind:'trigger',icon:Zap,label:'Gatilho',description:'Inicia o fluxo',rule:'Aceita apenas o evento (mensagem recebida, etiqueta adicionada ou conversa criada) e, para etiqueta, o id dela. Só um gatilho pode ser o nó inicial.'},
  {kind:'message',icon:MessageSquare,label:'Mensagem',description:'Envia texto, arquivos e mídia no WhatsApp',rule:'1 a 30 conteúdos: texto, arquivo, mídia e pausa, enviados em ordem.'},
  {kind:'image',icon:Image,label:'Imagem',description:'Envia imagem com legenda',rule:'URL HTTPS obrigatória (até 2048 caracteres) e legenda opcional de até 1024.'},
  {kind:'audio',icon:Mic,label:'Áudio',description:'Envia áudio ou mensagem de voz',rule:'URL HTTPS obrigatória; enviar como voz é opcional.'},
  {kind:'sticker',icon:Sticker,label:'Figurinha',description:'Envia uma figurinha',rule:'URL HTTPS obrigatória, apontando para um WebP compatível.'},
  {kind:'buttons',icon:List,label:'Menu interativo',description:'Oferece até três escolhas',rule:'Texto de 1 a 1024, rodapé até 60 e de 1 a 3 botões com identificador e texto (até 20) únicos.'},
  {kind:'wait_response',icon:Hourglass,label:'Aguarda Resposta',description:'Pausa até o contato responder',rule:'Saída de resposta obrigatória; saída de timeout opcional (não existe ao esperar indefinidamente). Espera máxima de 31 dias; junta mensagens por até 300 s.'},
  {kind:'ai',icon:Bot,label:'Bloco de IA',description:'Chama a IA com prompt próprio',rule:'Exige prompt de sistema. Saída de sucesso grava a resposta na variável; saída de erro grava o motivo.'},
  {kind:'agent',icon:Sparkles,label:'Agente de IA',description:'Responde com um agente cadastrado',rule:'Exige um agente de IA selecionado e ativo.'},
  {kind:'condition',icon:GitBranch,label:'Condicional',description:'Cria caminhos de decisão',rule:'Único bloco com mais de uma saída: precisa de ao menos duas, exatamente uma rota padrão e condição em cada saída não padrão, com prioridades distintas.'},
  {kind:'delay',icon:Clock,label:'Intervalo inteligente',description:'Aguarda antes de continuar',rule:'Duração inteira entre 1 segundo e 30 dias.'},
  {kind:'webhook',icon:Webhook,label:'Integração',description:'Faz uma requisição HTTP',rule:'URL válida e obrigatoriamente HTTPS.'},
  {kind:'assign',icon:Building2,label:'Departamento',description:'Define fila ou responsável',rule:'Exige uma fila ou um responsável.'},
  {kind:'tag',icon:Tag,label:'Etiquetas',description:'Adiciona ou remove etiquetas',rule:'Exige ao menos uma etiqueta selecionada ou informada.'},
  {kind:'kanban',icon:Columns3,label:'Kanban',description:'Cria ou move o card do contato',rule:'Exige um quadro e uma coluna existentes. Pode criar ou mover, somente criar ou somente mover.'},
  {kind:'handoff',icon:Headset,label:'Handoff',description:'Transfere para humano',rule:'Bloco final da jornada.'},
  {kind:'outcome',icon:CircleCheck,label:'Resultado',description:'Encerra com sucesso',rule:'Tipo obrigatório entre lead qualificado, agendamento, venda, resolvido, transferência e desqualificado. Bloco final da jornada.'}
];
const kindMeta=Object.fromEntries(catalog.map(item=>[item.kind,item])) as Record<AutomationNodeKind,(typeof catalog)[number]>;
// Mirrors packages/contracts/src/ports.ts (NODE_PORTS).
const NODE_PORTS:Partial<Record<AutomationNodeKind,Array<'success'|'failure'|'reply'|'timeout'>>>={webhook:['success','failure'],ai:['success','failure'],wait_response:['reply','timeout']};
const PORT_LABELS={success:'sucesso',failure:'erro',reply:'respondeu',timeout:'não respondeu'} as const;
// Mirrors packages/contracts (WAIT_*); duplicated so the web bundle does not pull zod in.
const WAIT_MAX_SECONDS=2_678_400;
const WAIT_MAX_BUFFER_SECONDS=300;
const WAIT_UNIT_SECONDS={minutes:60,hours:3600,days:86400} as const;
const WAIT_UNIT_LABELS={minutes:'minutos',hours:'horas',days:'dias'} as const;
type WaitUnit=keyof typeof WAIT_UNIT_SECONDS;
const waitUnitOf=(config:Record<string,unknown>):WaitUnit=>config.timeoutUnit==='minutes'||config.timeoutUnit==='days'?config.timeoutUnit:'hours';
const waitIndefinite=(config:Record<string,unknown>)=>config.waitIndefinitely===true;
const terminalKinds=new Set<AutomationNodeKind>(['outcome','handoff']);
function connectionRule(kind:AutomationNodeKind){return kind==='wait_response'?'Saídas: respondeu (obrigatória) e não respondeu (opcional).':NODE_PORTS[kind]?'Saídas: sucesso (obrigatória) e erro (opcional).':terminalKinds.has(kind)?'Não pode ter conexões de saída.':kind==='condition'?'':'Precisa de exatamente uma conexão de saída.'}
// Mirrors packages/contracts (MESSAGE_*); duplicated so the web bundle does not pull zod in.
const MESSAGE_MAX_ITEMS=30;
const MESSAGE_MAX_TYPING_SECONDS=30;
const MESSAGE_MAX_PAUSE_SECONDS=300;
type MessageItem={type:'text';text:string;typingSeconds:number}|{type:'file';url:string;fileName:string;caption?:string}|{type:'media';mediaType:'image'|'video'|'audio';url:string;caption?:string;ptt?:boolean}|{type:'pause';minSeconds:number;maxSeconds:number};
const MEDIA_LABELS={image:'Imagem',video:'Vídeo',audio:'Áudio'} as const;
function messageItemsOf(config:Record<string,unknown>):MessageItem[]{
  if(Array.isArray(config.items))return config.items as MessageItem[];
  return [{type:'text',text:typeof config.text==='string'?config.text:'',typingSeconds:0}];
}
function messageItemLabel(item:MessageItem){
  return item.type==='text'?item.text:item.type==='file'?item.fileName||'Arquivo':item.type==='media'?(item.caption||MEDIA_LABELS[item.mediaType]):`Pausa de ${item.minSeconds} a ${item.maxSeconds} s`;
}
// Mirrors packages/contracts (MENU_*); duplicated so the web bundle does not pull zod in.
const MENU_CHOICE_FIELD='menu.choice';
const MENU_LIMIT={buttons:3,list:10} as const;
const MENU_MAX_TIMEOUT_SECONDS=2_678_400;
type MenuMode=keyof typeof MENU_LIMIT;
type MenuOption={id:string;label:string;description?:string};
function menuOptionsOf(config:Record<string,unknown>):MenuOption[]{return (Array.isArray(config.buttons)?config.buttons:[]).flatMap(item=>{const option=item&&typeof item==='object'?item as Record<string,unknown>:{};return typeof option.id==='string'?[{id:option.id,label:typeof option.label==='string'?option.label:'',...(typeof option.description==='string'&&option.description?{description:option.description}:{})}]:[]})}
// Which handle of the source node an edge leaves from; persisted edges only carry their condition.
function sourceHandleFor(kind:AutomationNodeKind|undefined,edge:AutomationEdge){
  if(kind&&NODE_PORTS[kind])return edge.port??NODE_PORTS[kind]![0];
  if(kind==='condition'&&edge.isDefault)return 'fallback';
  if(kind==='buttons'){if(edge.isDefault)return 'timeout';if(edge.condition?.field===MENU_CHOICE_FIELD)return `opt:${String(edge.condition.value)}`}
  return undefined;
}
const emptyDefinition:AutomationDefinition={start:'',nodes:[],edges:[],settings:{maxSteps:30,timeoutSeconds:300}};

function nodeSummary(kind:AutomationNodeKind,config:Record<string,unknown>){
  if(kind==='message'){const items=messageItemsOf(config);const first=items.find(item=>item.type==='text'&&item.text.trim())??items[0];return `${first?messageItemLabel(first):''}${items.length>1?` · +${items.length-1} ${items.length-1===1?'conteúdo':'conteúdos'}`:''}`}
  if(kind==='buttons')return String(config.text??'');
  if(kind==='image')return String(config.caption||config.url||'Escolha uma imagem');
  if(kind==='audio')return config.ptt?'Mensagem de voz':String(config.url||'Escolha um áudio');
  if(kind==='sticker')return String(config.url||'Escolha uma figurinha');
  if(kind==='trigger')return String(config.event??'message.received').replace('message.received','Mensagem recebida').replace('tag.added','Etiqueta adicionada').replace('conversation.created','Conversa criada');
  if(kind==='delay'){const seconds=Number(config.seconds??0);return seconds>=86400?`Aguardar ${Math.round(seconds/86400)} dia(s)`:seconds>=3600?`Aguardar ${Math.round(seconds/3600)} hora(s)`:seconds>=60?`Aguardar ${Math.round(seconds/60)} minuto(s)`:`Aguardar ${seconds} segundo(s)`}
  if(kind==='webhook')return `${String(config.method??'POST')} · ${String(config.url||'URL não definida')}`;
  if(kind==='assign')return `Atribuir para ${String(config.queue||config.assigneeId||'destino não definido')}`;
  if(kind==='handoff')return `Transferir para ${String(config.queue||'atendimento humano')}`;
  if(kind==='tag'){const total=(Array.isArray(config.tagIds)?config.tagIds.length:0)+(Array.isArray(config.tags)?config.tags.length:0)+(config.tagId||config.tag?1:0);return `${config.mode==='remove'?'Remover':'Adicionar'} ${total||0} etiqueta(s)`}
  if(kind==='kanban')return config.boardId&&config.columnId?'Criar ou mover card na coluna selecionada':'Selecione quadro e coluna';
  if(kind==='wait_response'){const n=Number(config.bufferSeconds??0);return `${waitIndefinite(config)?'Indefinidamente':`Até ${Number(config.timeoutValue??1)} ${WAIT_UNIT_LABELS[waitUnitOf(config)]}`}${n>0?` · junta ${n} s`:''}`}
  if(kind==='ai')return `${String(config.model||'gpt-5.4-mini')} · resposta em ${String(config.responseVariable||'resposta.gpt')}`;
  if(kind==='agent')return config.agentId?'Agente configurado':'Selecione um agente';
  if(kind==='condition'&&Array.isArray(config.rules))return `${config.rules.length} condição(ões) · ${config.logic==='any'?'QUALQUER':'TODAS'}`;
  if(kind==='outcome')return String(config.type??'RESOLVED');
  return 'Configure as rotas nas conexões';
}
function nodePreviewLabel(kind:AutomationNodeKind){
  const labels:Record<AutomationNodeKind,string>={trigger:'Evento:',message:'Mensagem:',image:'Imagem:',audio:'Áudio:',sticker:'Figurinha:',buttons:'Texto do menu:',agent:'Agente:',condition:'Regras:',delay:'Aguardar por:',webhook:'Requisição:',assign:'Encaminhar para:',tag:'Ação:',handoff:'Transferir para:',outcome:'Resultado:',ai:'Modelo:',wait_response:'Aguardar:',kanban:'Destino:'};
  return labels[kind];
}
function flowAction(action:'edit'|'duplicate'|'remove',id:string){window.dispatchEvent(new CustomEvent('nexo-flow-action',{detail:{action,id}}))}
function AutomationNodeCard({id,data,selected}:NodeProps<FlowNode>){const meta=kindMeta[data.kind];const Icon=meta.icon;const terminal=data.kind==='outcome'||data.kind==='handoff';const buttonItems=data.kind==='buttons'&&Array.isArray(data.config.buttons)?data.config.buttons as Array<{id?:string;label?:string}>:[];return <div className={`automation-node automation-node-${data.kind} ${selected?'selected':''}`}>
  {data.kind!=='trigger'&&<Handle type="target" position={Position.Left} />}
  <div className="automation-node-head"><span className="automation-node-icon"><Icon size={16} aria-hidden="true"/></span><span><small>{meta.label}</small><b>{data.name}</b></span><span className="node-quick-actions nodrag"><button title="Editar bloco" aria-label={`Editar ${data.name}`} onClick={event=>{event.stopPropagation();flowAction('edit',id)}}>✎</button><button title="Duplicar bloco" aria-label={`Duplicar ${data.name}`} onClick={event=>{event.stopPropagation();flowAction('duplicate',id)}}>⧉</button><button className="node-delete-action" title="Excluir bloco" aria-label={`Excluir ${data.name}`} onClick={event=>{event.stopPropagation();flowAction('remove',id)}}>×</button></span></div>
  <div className="node-config-preview"><span>{nodePreviewLabel(data.kind)}</span><strong>{nodeSummary(data.kind,data.config)||'Não configurado'}</strong></div>
  {data.kind==='condition'&&<div className="condition-node-routes"><span>Condição atendida</span><span>Caso contrário</span></div>}
  {data.kind==='buttons'&&<div className="node-button-list node-menu-routes">{buttonItems.map((button,index)=><div key={button.id||index}><span>{button.label||`Opção ${index+1}`}</span>{button.id&&<Handle id={`opt:${button.id}`} type="source" position={Position.Right}/>}</div>)}{Number(data.config.timeoutSeconds??0)>0&&<div className="menu-timeout-route"><span>Inatividade</span><Handle id="timeout" type="source" position={Position.Right}/></div>}</div>}
  {!terminal&&data.kind!=='buttons'&&!NODE_PORTS[data.kind]&&<Handle type="source" position={Position.Right} style={data.kind==='condition'?{top:'45%'}:undefined} />}
  {data.kind==='condition'&&<Handle id="fallback" type="source" position={Position.Right} style={{top:'78%'}} />}
  {NODE_PORTS[data.kind]&&<div className="node-ports">{NODE_PORTS[data.kind]!.filter(port=>!(data.kind==='wait_response'&&port==='timeout'&&waitIndefinite(data.config))).map(port=><div key={port} className={`node-port ${port}`}><span>{data.kind==='wait_response'?(port==='reply'?'Aguardar pela resposta do cliente.':`Ou caso não responda — Após ${Number(data.config.timeoutValue??1)} ${WAIT_UNIT_LABELS[waitUnitOf(data.config)]}`):PORT_LABELS[port]}</span><Handle id={port} type="source" position={Position.Right}/></div>)}</div>}
</div>}
const nodeTypes={automation:AutomationNodeCard};

function normalizeDefinition(value:AutomationDefinition|undefined):AutomationDefinition{
  if(!value||!Array.isArray(value.nodes))return emptyDefinition;
  return {start:value.start||value.nodes[0]?.id||'',nodes:value.nodes.map((node,index)=>({...node,kind:node.kind||'message',name:node.name||`Etapa ${index+1}`,config:normalizeNodeConfig(node.kind,node.config),position:node.position??{x:100+index*220,y:180}})),edges:Array.isArray(value.edges)?value.edges:[],settings:{maxSteps:value.settings?.maxSteps??30,timeoutSeconds:value.settings?.timeoutSeconds??300}}
}
function toFlow(definition:AutomationDefinition){
  const nodes:FlowNode[]=definition.nodes.map(node=>({id:node.id,type:'automation',position:node.position,data:{kind:node.kind,name:node.name,config:node.config}}));
  const kinds=new Map(definition.nodes.map(node=>[node.id,node.kind]));
  const edges:FlowEdge[]=definition.edges.map(edge=>({id:edge.id,source:edge.source,sourceHandle:sourceHandleFor(kinds.get(edge.source),edge),target:edge.target,label:edge.label,data:{condition:edge.condition,isDefault:edge.isDefault??false,priority:edge.priority??0,port:edge.port},type:'smoothstep',markerEnd:{type:MarkerType.ArrowClosed},animated:edge.label==='baixa confiança'}));
  return {nodes,edges}
}
function toDefinition(nodes:FlowNode[],edges:FlowEdge[],start:string,settings:AutomationDefinition['settings']):AutomationDefinition{return {start:nodes.some(node=>node.id===start)?start:(nodes.find(node=>node.data.kind==='trigger')?.id??nodes[0]?.id??''),nodes:nodes.map(node=>({id:node.id,kind:node.data.kind,name:node.data.name,config:node.data.config,position:node.position})),edges:edges.map(edge=>({id:edge.id,source:edge.source,target:edge.target,...(edge.label?{label:String(edge.label)}:{}),...(edge.data?.condition?{condition:edge.data.condition}:{}),...(edge.data?.port?{port:edge.data.port}:{}),isDefault:edge.data?.isDefault??false,priority:edge.data?.priority??0})),settings}}

export function PlaybookEditorPage(){
  const {id=''}=useParams();const playbook=usePlaybook(id);const agents=useAgents();const aiKey=useWorkspaceAiKey();const contactMeta=useContactMeta();const kanbanBoards=useKanbanBoards();const save=useSavePlaybookVersion();const validate=useValidatePlaybook();const simulate=useSimulatePlaybook();const publish=usePublishPlaybook();
  const [nodes,setNodes]=useState<FlowNode[]>([]);const [edges,setEdges]=useState<FlowEdge[]>([]);const [start,setStart]=useState('');const [settings,setSettings]=useState(emptyDefinition.settings);
  const [selectedNodeId,setSelectedNodeId]=useState<string|null>(null);const [selectedEdgeId,setSelectedEdgeId]=useState<string|null>(null);const [version,setVersion]=useState(0);const [loadedKey,setLoadedKey]=useState('');
  const [dirty,setDirty]=useState(false);const [result,setResult]=useState<AutomationValidation|null>(null);const [notice,setNotice]=useState<{tone:'success'|'error'|'info';text:string}|null>(null);const [simulationVariables,setSimulationVariables]=useState('{}');const [restoredVersion,setRestoredVersion]=useState<number|null>(null);const [toolsOpen,setToolsOpen]=useState(true);const [toolsQuery,setToolsQuery]=useState('');const [inspectorOpen,setInspectorOpen]=useState(false);const flowRef=useRef<ReactFlowInstance<FlowNode,FlowEdge>|null>(null);
  const latest=playbook.data?.versions?.[0];
  useEffect(()=>{if(!playbook.data||loadedKey.startsWith(`${playbook.data.id}:`))return;const definition=normalizeDefinition(latest?.definition);const flow=toFlow(definition);setNodes(flow.nodes);setEdges(flow.edges);setStart(definition.start);setSettings(definition.settings);setVersion(latest?.version??0);setLoadedKey(`${playbook.data.id}:${latest?.id??'empty'}`)},[playbook.data,latest,loadedKey]);
  const definition=useMemo(()=>toDefinition(nodes,edges,start,settings),[nodes,edges,start,settings]);
  const selectedNode=nodes.find(node=>node.id===selectedNodeId)??null;const selectedEdge=edges.find(edge=>edge.id===selectedEdgeId)??null;
  const busy=save.isPending||validate.isPending||simulate.isPending||publish.isPending;
  const mutateNodes=useCallback((changes:NodeChange<FlowNode>[])=>{setNodes(current=>applyNodeChanges(changes,current));setDirty(true);setResult(null)},[]);
  const mutateEdges=useCallback((changes:EdgeChange<FlowEdge>[])=>{setEdges(current=>applyEdgeChanges(changes,current));setDirty(true);setResult(null)},[]);
  const connect=useCallback((connection:Connection)=>{
    const handle=connection.sourceHandle??'';const source=nodes.find(node=>node.id===connection.source);
    let data:FlowEdgeData={isDefault:false,priority:0};let label:string|undefined;
    if(handle.startsWith('opt:')){const optionId=handle.slice(4);const options=source?menuOptionsOf(source.data.config):[];const index=options.findIndex(option=>option.id===optionId);data={condition:{field:MENU_CHOICE_FIELD,operator:'equals',value:optionId},isDefault:false,priority:Math.max(index,0)};label=options[index]?.label}
    else if(handle==='timeout'&&source?.data.kind==='buttons'){data={isDefault:true,priority:1000};label='Inatividade'}
    else if(source&&NODE_PORTS[source.data.kind]&&(handle==='success'||handle==='failure'||handle==='reply'||handle==='timeout')){data={port:handle,isDefault:false,priority:NODE_PORTS[source.data.kind]!.indexOf(handle)};label=PORT_LABELS[handle]}
    else if(source?.data.kind==='condition'){const fallback=handle==='fallback';data={isDefault:fallback,priority:fallback?1000:0};label=fallback?'Caso contrário':'Condição atendida'}
    // A menu exit leads to a single place: reconnecting it replaces the previous edge.
    const replaces=(edge:FlowEdge)=>(source?.data.kind==='buttons'||Boolean(source&&NODE_PORTS[source.data.kind]))&&edge.source===connection.source&&edge.sourceHandle===connection.sourceHandle;
    setEdges(current=>addEdge({...connection,id:crypto.randomUUID(),label,data,type:'smoothstep',markerEnd:{type:MarkerType.ArrowClosed}},current.filter(edge=>!replaces(edge))));setDirty(true);setResult(null)
  },[nodes]);
  function dragStart(event:DragEvent,kind:AutomationNodeKind){event.dataTransfer.setData('application/nexo-node',kind);event.dataTransfer.effectAllowed='move'}
  function drop(event:DragEvent){event.preventDefault();const kind=event.dataTransfer.getData('application/nexo-node') as AutomationNodeKind;if(!kindMeta[kind]||!flowRef.current)return;const position=flowRef.current.screenToFlowPosition({x:event.clientX,y:event.clientY});const id=crypto.randomUUID();const meta=kindMeta[kind];setNodes(current=>[...current,{id,type:'automation',position,data:{kind,name:meta.label,config:defaultConfig(kind)}}]);if(kind==='trigger'&&!start)setStart(id);setDirty(true);setSelectedNodeId(id);setSelectedEdgeId(null);setResult(null)}
  function updateSelected(patch:Partial<FlowNodeData>){if(!selectedNodeId)return;setNodes(current=>current.map(node=>node.id===selectedNodeId?{...node,data:{...node.data,...patch}}:node));setDirty(true);setResult(null)}
  function updateConfig(key:string,value:unknown){if(!selectedNode)return;updateSelected({config:{...selectedNode.data.config,[key]:value}})}
  function updateConfigs(patch:Record<string,unknown>){if(!selectedNode)return;if(selectedNode.data.kind==='wait_response'&&patch.waitIndefinitely===true){const nodeId=selectedNode.id;setEdges(current=>current.filter(edge=>!(edge.source===nodeId&&edge.sourceHandle==='timeout')))}updateSelected({config:{...selectedNode.data.config,...patch}})}
  function saveCondition(name:string,config:Record<string,unknown>){updateSelected({name,config});setInspectorOpen(false)}
  function saveMenu(name:string,config:Record<string,unknown>){
    if(!selectedNode)return;const nodeId=selectedNode.id;const options=menuOptionsOf(config);const labels=new Map(options.map(option=>[option.id,option.label]));const hasTimeout=Number(config.timeoutSeconds??0)>0;
    updateSelected({name,config});
    setEdges(current=>current.flatMap(edge=>{
      if(edge.source!==nodeId)return [edge];
      if(edge.sourceHandle==='timeout')return hasTimeout?[edge]:[];
      if(!edge.sourceHandle?.startsWith('opt:'))return [edge];
      const optionId=edge.sourceHandle.slice(4);
      return labels.has(optionId)?[{...edge,label:labels.get(optionId)||edge.label}]:[];
    }));
    setInspectorOpen(false);
  }
  function updateSelectedEdge(patch:Partial<FlowEdgeData>&{label?:string}){if(!selectedEdgeId)return;setEdges(current=>current.map(edge=>edge.id===selectedEdgeId?{...edge,...(patch.label!==undefined?{label:patch.label}:{}),data:{...edge.data,condition:patch.isDefault===true?undefined:(patch.condition??edge.data?.condition),isDefault:patch.isDefault??edge.data?.isDefault,priority:patch.priority??edge.data?.priority}}:edge));setDirty(true);setResult(null)}
  const removeNode=useCallback((nodeId:string)=>{setNodes(current=>current.filter(node=>node.id!==nodeId));setEdges(current=>current.filter(edge=>edge.source!==nodeId&&edge.target!==nodeId));setStart(current=>current===nodeId?'':current);setSelectedNodeId(current=>current===nodeId?null:current);setDirty(true);setResult(null)},[]);
  const duplicateNode=useCallback((nodeId:string)=>{setNodes(current=>{const source=current.find(node=>node.id===nodeId);if(!source)return current;const id=crypto.randomUUID();const copy:FlowNode={...source,id,selected:false,position:{x:source.position.x+45,y:source.position.y+75},data:{...source.data,name:`${source.data.name} (cópia)`,config:structuredClone(source.data.config)}};setSelectedNodeId(id);setSelectedEdgeId(null);return [...current,copy]});setDirty(true);setResult(null)},[]);
  useEffect(()=>{const handler=(event:Event)=>{const detail=(event as CustomEvent<{action:'edit'|'duplicate'|'remove';id:string}>).detail;if(detail.action==='edit'){setSelectedNodeId(detail.id);setSelectedEdgeId(null);setInspectorOpen(true)}else if(detail.action==='duplicate')duplicateNode(detail.id);else removeNode(detail.id)};window.addEventListener('nexo-flow-action',handler);return()=>window.removeEventListener('nexo-flow-action',handler)},[duplicateNode,removeNode]);
  useEffect(()=>{if(!inspectorOpen||!selectedNode)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setInspectorOpen(false)};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[inspectorOpen,selectedNode]);
  function removeSelection(){if(selectedNodeId){setNodes(current=>current.filter(node=>node.id!==selectedNodeId));setEdges(current=>current.filter(edge=>edge.source!==selectedNodeId&&edge.target!==selectedNodeId));if(start===selectedNodeId)setStart('');setSelectedNodeId(null)}else if(selectedEdgeId){setEdges(current=>current.filter(edge=>edge.id!==selectedEdgeId));setSelectedEdgeId(null)}setDirty(true);setResult(null)}
  function parseSimulationVariables(){try{const parsed:unknown=JSON.parse(simulationVariables||'{}');if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw new Error();return parsed as Record<string,unknown>}catch{setNotice({tone:'error',text:'As variáveis da simulação precisam ser um objeto JSON válido.'});return null}}
  async function runValidation(){const variables=parseSimulationVariables();if(!variables)return null;setInspectorOpen(true);setSelectedNodeId(null);setSelectedEdgeId(null);try{const checked=await validate.mutateAsync({id,definition});if(!checked.valid){setResult(checked);setNotice({tone:'error',text:`${checked.issues.length} ponto(s) precisam de atenção.`});return checked}const simulated=await simulate.mutateAsync({id,definition,variables});const response:AutomationValidation={...simulated.validation,simulation:simulated.simulation};setResult(response);setNotice({tone:'success',text:'Fluxo válido. A simulação foi concluída.'});return response}catch(error){setNotice({tone:'error',text:errorMessage(error)});return null}}
  async function saveChanges(){try{const response=await save.mutateAsync({id,expectedVersion:version,definition});setVersion(response.version);setDirty(false);setNotice({tone:'success',text:`Versão ${response.version} salva com sucesso.`});return response.version}catch(error){setNotice({tone:'error',text:errorMessage(error)});return null}}
  function restoreLocal(item:PlaybookVersion){const restored=normalizeDefinition(item.definition);const flow=toFlow(restored);setNodes(flow.nodes);setEdges(flow.edges);setStart(restored.start);setSettings(restored.settings);setSelectedNodeId(null);setSelectedEdgeId(null);setResult(null);setRestoredVersion(item.version);setDirty(true);setNotice({tone:'info',text:`Versão ${item.version} carregada no editor. Salve para criar uma nova versão a partir dela.`});requestAnimationFrame(()=>flowRef.current?.fitView({padding:.25,duration:300}))}
  async function publishFlow(){const checked=await runValidation();if(!checked?.valid)return;const targetVersion=dirty?await saveChanges():version;if(targetVersion===null)return;try{await publish.mutateAsync({id,version:targetVersion});setNotice({tone:'success',text:`Versão ${targetVersion} publicada. As próximas conversas usarão este fluxo.`})}catch(error){setNotice({tone:'error',text:errorMessage(error)})}}
  if(playbook.isLoading)return <div className="flow-editor-state">Carregando editor…</div>;
  if(playbook.isError||!playbook.data)return <div className="flow-editor-state error"><h2>Não foi possível abrir este fluxo</h2><button onClick={()=>playbook.refetch()}>Tentar novamente</button></div>;
  const toolsResults=catalog.filter(item=>`${item.label} ${item.description}`.toLowerCase().includes(toolsQuery.trim().toLowerCase()));
  return <div className="flow-editor-shell">
    <div className="flow-editor-toolbar"><button className={toolsOpen?'active':''} aria-expanded={toolsOpen} aria-controls="tools-dropdown" onClick={()=>setToolsOpen(value=>!value)}><Blocks size={16} aria-hidden="true"/> Ferramentas</button><button onClick={runValidation} disabled={busy}><Play size={16} aria-hidden="true"/> Simular</button></div>
    <header className="flow-editor-header"><div className="flow-editor-title"><Link to="/playbooks" aria-label="Voltar">←</Link><div><small>CONSTRUTOR DE FLUXOS</small><h1>{playbook.data.name}</h1></div><span className={playbook.data.status==='PUBLISHED'?'live':'draft'}>{playbook.data.status==='PUBLISHED'?'● Publicado':'Rascunho'}</span></div></header>
    <div className="flow-editor-actions"><span className={dirty?'unsaved':'saved'}>{dirty?'Alterações não salvas':`v${version} salva`}</span><button onClick={()=>{setSelectedNodeId(null);setSelectedEdgeId(null);setInspectorOpen(value=>!value)}}>Ajustes</button><button onClick={saveChanges} disabled={busy||!dirty}>Salvar</button><button className="primary" onClick={publishFlow} disabled={busy||nodes.length===0}>Publicar</button></div>
    {notice&&<div className={`editor-notice ${notice.tone}`}><span>{notice.text}</span><button onClick={()=>setNotice(null)}>×</button></div>}
    <div className="flow-editor-body">
      <section className="flow-canvas" onDrop={drop} onDragOver={event=>{event.preventDefault();event.dataTransfer.dropEffect='move'}}>
        <ReactFlow<FlowNode,FlowEdge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={mutateNodes} onEdgesChange={mutateEdges} onConnect={connect} onNodesDelete={deleted=>{const ids=new Set(deleted.map(node=>node.id));setEdges(current=>current.filter(edge=>!ids.has(edge.source)&&!ids.has(edge.target)));if(ids.has(start))setStart('');setSelectedNodeId(null);setInspectorOpen(false)}} onInit={instance=>{flowRef.current=instance}} onNodeClick={(_,node)=>{setSelectedNodeId(node.id);setSelectedEdgeId(null);setInspectorOpen(false)}} onEdgeClick={(_,edge)=>{setSelectedEdgeId(edge.id);setSelectedNodeId(null);setInspectorOpen(true)}} onPaneClick={()=>{setSelectedNodeId(null);setSelectedEdgeId(null);setInspectorOpen(false)}} deleteKeyCode={['Backspace','Delete']} fitView fitViewOptions={{padding:.25}} minZoom={.25} maxZoom={1.8}>
          <Background gap={22} size={1.2} color="#375448"/><MiniMap pannable zoomable nodeColor={node=>node.data.kind==='trigger'?'#20b958':node.data.kind==='condition'?'#23acd9':'#397af2'} maskColor="rgba(9,24,18,.72)"/><Controls showInteractive={false}/>
        </ReactFlow>
        {!nodes.length&&<div className="canvas-empty"><span>◇</span><b>Monte sua jornada</b><p>Arraste um gatilho para começar.</p></div>}
      </section>
      {toolsOpen&&<aside id="tools-dropdown" className="node-palette tools-dropdown" onKeyDown={event=>{if(event.key==='Escape')setToolsOpen(false)}}>
        <label className="palette-search"><Search size={16} aria-hidden="true"/><input autoFocus type="search" value={toolsQuery} onChange={event=>setToolsQuery(event.target.value)} placeholder="Buscar blocos…" aria-label="Buscar blocos" /></label>
        {toolsResults.map(item=><button draggable title={item.rule} onDragStart={event=>dragStart(event,item.kind)} key={item.kind}><span className={`palette-icon ${item.kind}`}><item.icon size={18} aria-hidden="true"/></span><span><b>{item.label}</b><small>{item.description}</small></span><i>⠿</i></button>)}
        {toolsResults.length===0&&<p className="palette-empty">Nenhum bloco para “{toolsQuery}”. Tente “mensagem”, “condição” ou “etiqueta”.</p>}
      </aside>}
      {inspectorOpen&&selectedNode&&<div className="node-modal-backdrop" onMouseDown={()=>setInspectorOpen(false)} aria-hidden="true"/>}
      {inspectorOpen&&<aside role={selectedNode?'dialog':undefined} aria-modal={selectedNode?true:undefined} aria-label={selectedNode?`Editar ${selectedNode.data.name}`:undefined} className={`flow-inspector floating-panel ${selectedNode?'node-edit-modal':''}`}><button className="panel-close" aria-label="Fechar configurações" onClick={()=>setInspectorOpen(false)}>×</button>
        {selectedNode
          ? selectedNode.data.kind==='message'
            ? <MessageEditor key={selectedNode.id} node={selectedNode} onSave={(name,config)=>{updateSelected({name,config});setInspectorOpen(false)}} onCancel={()=>setInspectorOpen(false)}/>
            : selectedNode.data.kind==='buttons'
            ? <MenuEditor key={selectedNode.id} node={selectedNode} onSave={saveMenu} onCancel={()=>setInspectorOpen(false)}/>
            : selectedNode.data.kind==='condition'
              ? <ConditionEditor key={selectedNode.id} node={selectedNode} tags={contactMeta.data?.tags??[]} members={contactMeta.data?.members??[]} boards={kanbanBoards.data??[]} onSave={saveCondition} onCancel={()=>setInspectorOpen(false)}/>
            : <NodeInspector node={selectedNode} agents={agents.data??[]} agentsLoading={agents.isLoading} aiKeyConfigured={aiKey.data?.configured} tags={contactMeta.data?.tags??[]} boards={kanbanBoards.data??[]} isStart={selectedNode.id===start} onName={name=>updateSelected({name})} onConfig={updateConfig} onConfigs={updateConfigs} onStart={()=>{setStart(selectedNode.id);setDirty(true)}} onRemove={removeSelection}/>
          : selectedEdge
            ? <EdgeInspector edge={selectedEdge} onChange={updateSelectedEdge} onRemove={removeSelection}/>
            : <FlowInspector definition={definition} result={result} version={version} restoredVersion={restoredVersion} versions={playbook.data.versions??[]} simulationVariables={simulationVariables} onSimulationVariables={setSimulationVariables} onRestore={restoreLocal} onSettings={next=>{setSettings(next);setDirty(true);setResult(null)}} onSelectIssue={(nodeId,edgeId)=>{if(nodeId){setSelectedNodeId(nodeId);setSelectedEdgeId(null);setInspectorOpen(false);flowRef.current?.fitView({nodes:[{id:nodeId}],duration:250,padding:1})}else if(edgeId){setSelectedEdgeId(edgeId);setSelectedNodeId(null)}}}/>
        }
      </aside>}
    </div>
  </div>
}

function defaultConfig(kind:AutomationNodeKind):Record<string,unknown>{
  switch(kind){
    case 'trigger':return {event:'message.received'};
    case 'message':return {items:[{type:'text',text:'',typingSeconds:0}]};
    case 'image':return {url:'',caption:''};
    case 'audio':return {url:'',ptt:true};
    case 'sticker':return {url:''};
    case 'buttons':return {mode:'list',text:'',buttonText:'',buttons:[],timeoutSeconds:0};
    case 'agent':return {agentId:'',prompt:''};
    case 'condition':return {logic:'all',rules:[]};
    case 'delay':return {seconds:300,unit:'minutes'};
    case 'webhook':return {url:'',method:'POST',headers:{},body:'',responseVariable:'integration.response'};
    case 'assign':return {queue:'Atendimento',assigneeId:''};
    case 'tag':return {mode:'add',tagIds:[],tags:[]};
    case 'kanban':return {boardId:'',columnId:'',mode:'create_or_move'};
    case 'handoff':return {queue:'Atendimento',reason:'Transferência solicitada pela automação.'};
    case 'outcome':return {type:'RESOLVED'};
    case 'wait_response':return {timeoutValue:1,timeoutUnit:'hours',waitIndefinitely:false,bufferSeconds:0};
    case 'ai':return {model:'gpt-5.4-mini',systemPrompt:'',userMessage:'{{last_message}}',understandImage:false,understandPdf:false,responseVariable:'resposta.gpt',failReasonVariable:'ai.fail.reason',autoSendResponse:false,contextInteractions:1};
  }
}
function normalizeNodeConfig(kind:AutomationNodeKind,value:Record<string,unknown>|undefined):Record<string,unknown>{
  const config={...(value??{})};
  if(kind==='agent'&&typeof config.prompt!=='string'&&typeof config.instructions==='string'){config.prompt=config.instructions;delete config.instructions}
  if(kind==='message'&&!Array.isArray(config.items)){config.items=[{type:'text',text:typeof config.text==='string'?config.text:'',typingSeconds:0}];delete config.text}
  if(kind==='buttons'&&!Array.isArray(config.buttons))config.buttons=[];
  if(kind==='condition'&&Array.isArray(config.rules)&&typeof config.logic!=='string')config.logic='all';
  if(kind==='webhook'&&typeof config.method!=='string')config.method='POST';
  if(kind==='tag'&&!Array.isArray(config.tagIds))config.tagIds=typeof config.tagId==='string'&&config.tagId?[config.tagId]:[];
  if(kind==='tag'&&!Array.isArray(config.tags))config.tags=typeof config.tag==='string'&&config.tag?[config.tag]:[];
  if(kind==='tag'&&typeof config.mode!=='string')config.mode='add';
  if(kind==='tag'&&config.tagId==='')delete config.tagId;
  if(kind==='tag'&&config.tag==='')delete config.tag;
  if(kind==='handoff'&&typeof config.queue!=='string'&&typeof config.team==='string'){config.queue=config.team;delete config.team}
  if(kind==='outcome'&&typeof config.type!=='string'){config.type=typeof config.outcome==='string'&&['QUALIFIED','APPOINTMENT','SALE','RESOLVED','HANDOFF','DISQUALIFIED'].includes(config.outcome.toUpperCase())?config.outcome.toUpperCase():'RESOLVED';delete config.outcome}
  return config
}
function JsonHeadersField({value,onChange}:{value:unknown;onChange:(value:Record<string,string>)=>void}){
  const normalized=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};const serialized=JSON.stringify(normalized,null,2);const [draft,setDraft]=useState(serialized);const [error,setError]=useState(false);
  useEffect(()=>{setDraft(serialized);setError(false)},[serialized]);
  function commit(){try{const parsed:unknown=JSON.parse(draft||'{}');if(!parsed||Array.isArray(parsed)||typeof parsed!=='object'||Object.values(parsed).some(item=>typeof item!=='string'))throw new Error();onChange(parsed as Record<string,string>);setError(false)}catch{setError(true)}}
  return <label>Cabeçalhos HTTP<textarea rows={4} spellCheck={false} value={draft} onChange={event=>setDraft(event.target.value)} onBlur={commit}/><small className={error?'field-error':undefined}>{error?'Use um objeto JSON com valores em texto.':'Objeto JSON; variáveis também são aceitas nos valores.'}</small></label>
}
function WaitFields({config,onConfigs}:{config:Record<string,unknown>;onConfigs:(patch:Record<string,unknown>)=>void}){
  const unit=waitUnitOf(config);const indefinite=waitIndefinite(config);const value=Number(config.timeoutValue??1);const buffer=Number(config.bufferSeconds??0);
  const timeError=!indefinite&&(!Number.isInteger(value)||value<1?'Informe um número inteiro a partir de 1.':value*WAIT_UNIT_SECONDS[unit]>WAIT_MAX_SECONDS?'O limite é 31 dias no total.':'');
  const bufferError=!Number.isInteger(buffer)||buffer<0||buffer>WAIT_MAX_BUFFER_SECONDS?`Use de 0 a ${WAIT_MAX_BUFFER_SECONDS} segundos.`:'';
  return <><div className="duration-fields"><label>Tempo<input type="number" min="1" step="1" value={value} disabled={indefinite} onChange={event=>onConfigs({timeoutValue:Number(event.target.value)})}/></label><label>Unidade<select value={unit} disabled={indefinite} onChange={event=>onConfigs({timeoutUnit:event.target.value})}>{(Object.keys(WAIT_UNIT_LABELS) as WaitUnit[]).map(item=><option key={item} value={item}>{WAIT_UNIT_LABELS[item].replace(/^./,letter=>letter.toUpperCase())}</option>)}</select></label></div>{timeError&&<small className="field-error">{timeError}</small>}
    <label className="check-field"><input type="checkbox" checked={indefinite} onChange={event=>onConfigs({waitIndefinitely:event.target.checked})}/> Esperar indefinidamente</label>
    <label>Juntar mensagens por (segundos)<input type="number" min="0" max={WAIT_MAX_BUFFER_SECONDS} step="1" value={buffer} onChange={event=>onConfigs({bufferSeconds:Number(event.target.value)})}/><small className={bufferError?'field-error':undefined}>{bufferError||'0 desliga: a primeira mensagem já é a resposta.'}</small></label></>
}
function NodeInspector({node,agents,agentsLoading,aiKeyConfigured,tags,boards,isStart,onName,onConfig,onConfigs,onStart,onRemove}:{node:FlowNode;agents:AiAgent[];agentsLoading:boolean;aiKeyConfigured:boolean|undefined;tags:ContactMeta['tags'];boards:KanbanBoard[];isStart:boolean;onName:(value:string)=>void;onConfig:(key:string,value:unknown)=>void;onConfigs:(patch:Record<string,unknown>)=>void;onStart:()=>void;onRemove:()=>void}){
  const kind=node.data.kind;const KindIcon=kindMeta[kind].icon;const config=node.data.config;
  const selectedTagIds=Array.isArray(config.tagIds)?config.tagIds.filter((value):value is string=>typeof value==='string'):[];
  const customTags=Array.isArray(config.tags)?config.tags.filter((value):value is string=>typeof value==='string'):[];
  const delayUnit=['seconds','minutes','hours','days'].includes(String(config.unit))?String(config.unit):'seconds';const delayFactor=delayUnit==='days'?86400:delayUnit==='hours'?3600:delayUnit==='minutes'?60:1;
  return <><header><span className={`palette-icon ${kind}`}><KindIcon size={16} aria-hidden="true"/></span><div><small>BLOCO SELECIONADO</small><b>{kindMeta[kind].label}</b></div></header><div className="inspector-form">
    <div className="config-callout"><b>Regra deste bloco</b><p>{kindMeta[kind].rule}{connectionRule(kind)?` ${connectionRule(kind)}`:''}</p></div>
    <label>Nome<input value={node.data.name} onChange={event=>onName(event.target.value)} /></label>
    {kind==='trigger'&&<label>Evento<select value={String(config.event??'message.received')} onChange={event=>onConfig('event',event.target.value)}><option value="message.received">Mensagem recebida</option><option value="tag.added">Etiqueta adicionada</option><option value="conversation.created">Conversa criada</option></select></label>}
    {kind==='image'&&<><label>URL HTTPS da imagem<input type="url" value={String(config.url??'')} onChange={event=>onConfig('url',event.target.value)} placeholder="https://cdn.exemplo.com/imagem.jpg" /></label><label>Legenda opcional<textarea rows={3} value={String(config.caption??'')} onChange={event=>onConfig('caption',event.target.value)} placeholder="Use {{variavel}} para personalizar." /></label></>}
    {kind==='audio'&&<><label>URL HTTPS do áudio<input type="url" value={String(config.url??'')} onChange={event=>onConfig('url',event.target.value)} placeholder="https://cdn.exemplo.com/audio.ogg" /></label><label className="check-field"><input type="checkbox" checked={config.ptt===true} onChange={event=>onConfig('ptt',event.target.checked)}/> Enviar como mensagem de voz</label></>}
    {kind==='sticker'&&<><label>URL HTTPS da figurinha<input type="url" value={String(config.url??'')} onChange={event=>onConfig('url',event.target.value)} placeholder="https://cdn.exemplo.com/figurinha.webp" /></label><p className="field-help">Use WebP compatível com WhatsApp. O arquivo será enviado pelo canal Baileys.</p></>}
    {kind==='ai'&&<>{aiKeyConfigured===false&&<p className="field-help">Sem chave da OpenAI no workspace, o bloco usa a chave padrão do servidor, se houver; sem nenhuma, segue pela saída de erro. Configure em Configurações → Inteligência artificial.</p>}<label>Modelo<input value={String(config.model??'gpt-5.4-mini')} onChange={event=>onConfig('model',event.target.value)} list="ai-models"/><datalist id="ai-models"><option value="gpt-5.4-mini"/><option value="gpt-5.4"/><option value="gpt-4.1-mini"/></datalist></label><label>Prompt do sistema<textarea rows={8} value={String(config.systemPrompt??'')} onChange={event=>onConfig('systemPrompt',event.target.value)} placeholder="Explique à IA o que analisar e o formato da resposta."/></label><label>Mensagem do usuário<input value={String(config.userMessage??'{{last_message}}')} onChange={event=>onConfig('userMessage',event.target.value)}/><small>Use {'{{last_message}}'} para a última mensagem do contato.</small></label><label className="check-field"><input type="checkbox" checked={config.understandImage===true} onChange={event=>onConfig('understandImage',event.target.checked)}/> Ler imagens recebidas</label><label className="check-field"><input type="checkbox" checked={config.understandPdf===true} onChange={event=>onConfig('understandPdf',event.target.checked)}/> Ler PDFs recebidos</label><label className="check-field"><input type="checkbox" checked={config.autoSendResponse===true} onChange={event=>onConfig('autoSendResponse',event.target.checked)}/> Enviar a resposta ao contato</label><label>Salvar resposta em<input value={String(config.responseVariable??'resposta.gpt')} onChange={event=>onConfig('responseVariable',event.target.value)}/></label><label>Salvar motivo da falha em<input value={String(config.failReasonVariable??'ai.fail.reason')} onChange={event=>onConfig('failReasonVariable',event.target.value)}/></label><label>Mensagens de contexto<input type="number" min="1" max="20" value={Number(config.contextInteractions??1)} onChange={event=>onConfig('contextInteractions',Math.min(20,Math.max(1,Number(event.target.value)||1)))}/></label></>}
    {kind==='wait_response'&&<WaitFields config={config} onConfigs={onConfigs}/>}
    {kind==='agent'&&<><label>Agente configurado<select value={String(config.agentId??'')} onChange={event=>onConfig('agentId',event.target.value)} disabled={agentsLoading}><option value="">{agentsLoading?'Carregando agentes…':'Selecione um agente'}</option>{agents.filter(agent=>agent.isActive).map(agent=><option key={agent.id} value={agent.id}>{agent.name} · {agent.model}</option>)}</select></label>{!agentsLoading&&!agents.some(agent=>agent.isActive)&&<p className="field-help">Crie e ative um agente no módulo Agentes de IA antes de publicar.</p>}<label>Instrução adicional do bloco<textarea rows={4} value={String(config.prompt??'')} onChange={event=>onConfig('prompt',event.target.value)} placeholder="Opcional: contexto específico desta etapa." /></label><p className="field-help">Objetivo, tom, confiança e handoff são controlados pelo agente selecionado.</p></>}
    {kind==='delay'&&<><div className="duration-fields"><label>Duração<input type="number" min="1" max={delayUnit==='days'?31:2678400} step="1" value={Math.max(1,Math.round(Number(config.seconds??300)/delayFactor))} onChange={event=>onConfig('seconds',Number(event.target.value)*delayFactor)}/></label><label>Unidade<select value={delayUnit} onChange={event=>{const unit=event.target.value;const factor=unit==='days'?86400:unit==='hours'?3600:unit==='minutes'?60:1;onConfigs({unit,seconds:Math.max(1,Math.round(Number(config.seconds??300)/delayFactor))*factor})}}><option value="seconds">Segundos</option><option value="minutes">Minutos</option><option value="hours">Horas</option><option value="days">Dias</option></select></label></div><p className="field-help">O fluxo pausa e retoma automaticamente. Limite total: 31 dias.</p></>}
    {kind==='webhook'&&<><label>URL HTTPS<input type="url" value={String(config.url??'')} onChange={event=>onConfig('url',event.target.value)} placeholder="https://api.exemplo.com/webhook" /></label><label>Método HTTP<select value={String(config.method??'POST')} onChange={event=>onConfig('method',event.target.value)}><option value="GET">GET</option><option value="POST">POST</option><option value="PUT">PUT</option><option value="PATCH">PATCH (legado)</option><option value="DELETE">DELETE (legado)</option></select></label><JsonHeadersField value={config.headers} onChange={value=>onConfig('headers',value)}/>{String(config.method??'POST')!=='GET'&&<label>Corpo da requisição<textarea rows={5} value={String(config.body??'')} onChange={event=>onConfig('body',event.target.value)} placeholder={'{"telefone":"{{contact.phone}}"}'}/><small>JSON ou texto; variáveis com {'{{caminho}}'}.</small></label>}<label>Salvar resposta na variável<input value={String(config.responseVariable??'')} onChange={event=>onConfig('responseVariable',event.target.value||undefined)} placeholder="integration.response" /></label><div className="response-fields"><b>Campos da resposta</b>{(Array.isArray(config.responseFields)?config.responseFields as Array<{path:string;variable:string}>:[]).map((field,index,all)=><div key={index}><input aria-label={`Caminho do campo ${index+1}`} value={field.path} onChange={event=>onConfig('responseFields',all.map((item,i)=>i===index?{...item,path:event.target.value}:item))} placeholder="body.accepted"/><input aria-label={`Variável do campo ${index+1}`} value={field.variable} onChange={event=>onConfig('responseFields',all.map((item,i)=>i===index?{...item,variable:event.target.value}:item))} placeholder="kovil.receipt.accepted"/><button type="button" aria-label={`Remover campo ${index+1}`} onClick={()=>onConfig('responseFields',all.filter((_,i)=>i!==index))}><X size={14}/></button></div>)}<button type="button" className="add-button-option" disabled={Array.isArray(config.responseFields)&&config.responseFields.length>=20} onClick={()=>onConfig('responseFields',[...(Array.isArray(config.responseFields)?config.responseFields:[]),{path:'',variable:''}])}>+ Adicionar campo</button><p className="field-help">Caminho em status, body ou headers da resposta (ex.: body.accepted) e a variável que recebe o valor.</p></div><p className="field-help">Respostas 2xx seguem por sucesso; erro HTTP, timeout de 15 s ou falha de rede seguem por erro.</p></>}
    {kind==='assign'&&<><label>Fila<input value={String(config.queue??'')} onChange={event=>onConfig('queue',event.target.value)} placeholder="Ex.: Comercial" /></label><div className="config-separator"><span>ou</span></div><label>ID do responsável<input value={String(config.assigneeId??'')} onChange={event=>onConfig('assigneeId',event.target.value)} placeholder="ID do usuário no workspace" /></label><p className="field-help">Preencha ao menos uma fila ou um responsável.</p></>}
    {kind==='tag'&&<><label>Ação<select value={String(config.mode??'add')} onChange={event=>onConfig('mode',event.target.value)}><option value="add">Adicionar etiquetas</option><option value="remove">Remover etiquetas</option></select></label><div className="tag-picker"><b>Etiquetas do workspace</b>{tags.length?tags.map(tag=><label key={tag.id} className="check-field"><input type="checkbox" checked={selectedTagIds.includes(tag.id)} onChange={event=>onConfig('tagIds',event.target.checked?[...selectedTagIds,tag.id]:selectedTagIds.filter(id=>id!==tag.id))}/><i style={{background:tag.color}}/>{tag.name}</label>):<p className="field-help">Nenhuma etiqueta cadastrada ainda.</p>}</div><label>Outras etiquetas, separadas por vírgula<input value={customTags.join(', ')} onChange={event=>onConfig('tags',event.target.value.split(',').map(value=>value.trim()).filter(Boolean))} placeholder="vip, retorno" /></label><p className="field-help">Ao adicionar, nomes novos são criados. Ao remover, nomes inexistentes são ignorados.</p></>}
    {kind==='kanban'&&<KanbanFields config={config} boards={boards} onConfigs={onConfigs}/>}
    {kind==='handoff'&&<><label>Fila de destino<input value={String(config.queue??'')} onChange={event=>onConfig('queue',event.target.value)} placeholder="Ex.: Atendimento" /></label><label>Motivo<textarea rows={4} value={String(config.reason??'')} onChange={event=>onConfig('reason',event.target.value)} placeholder="Explique por que a conversa será transferida." /></label></>}
    {kind==='outcome'&&<><label>Tipo de resultado<select value={String(config.type??'RESOLVED')} onChange={event=>onConfig('type',event.target.value)}><option value="QUALIFIED">Lead qualificado</option><option value="APPOINTMENT">Agendamento</option><option value="SALE">Venda</option><option value="RESOLVED">Atendimento resolvido</option><option value="HANDOFF">Transferência humana</option><option value="DISQUALIFIED">Lead desqualificado</option></select></label><label>Valor em centavos (opcional)<input type="number" min="0" step="1" value={typeof config.valueCents==='number'?config.valueCents:''} onChange={event=>onConfig('valueCents',event.target.value===''?undefined:Number(event.target.value))} placeholder="Ex.: 15000" /></label></>}
    <button className={isStart?'start active':'start'} onClick={onStart} disabled={isStart||kind!=='trigger'}>{isStart?'✓ Nó inicial do fluxo':kind==='trigger'?'Definir como nó inicial':'Somente um gatilho pode iniciar'}</button><button className="danger-link" onClick={onRemove}>Excluir bloco</button>
  </div></>
}
function KanbanFields({config,boards,onConfigs}:{config:Record<string,unknown>;boards:KanbanBoard[];onConfigs:(patch:Record<string,unknown>)=>void}){const board=boards.find(item=>item.id===config.boardId);return <><label>Quadro<select value={String(config.boardId??'')} onChange={event=>{const next=boards.find(item=>item.id===event.target.value);onConfigs({boardId:event.target.value,columnId:next?.columns[0]?.id??''})}}><option value="">Selecione um quadro</option>{boards.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Coluna<select value={String(config.columnId??'')} disabled={!board} onChange={event=>onConfigs({columnId:event.target.value})}><option value="">Selecione uma coluna</option>{board?.columns.map(column=><option value={column.id} key={column.id}>{column.name}</option>)}</select></label><label>Ação<select value={String(config.mode??'create_or_move')} onChange={event=>onConfigs({mode:event.target.value})}><option value="create_or_move">Criar ou mover card</option><option value="create_only">Somente criar se não existir</option><option value="move_only">Somente mover se já existir</option></select></label>{boards.length===0&&<p className="field-help">Crie um quadro e suas colunas no módulo Kanban antes de configurar este bloco.</p>}</>}
const MENU_EMOJIS=['😀','😊','😉','😍','🙏','👍','👋','🎉','🔥','✅','❌','⭐','💬','📅','📞','💰'];
const TIMEOUT_UNITS={minutes:60,hours:3600,days:86400} as const;
type TimeoutUnit=keyof typeof TIMEOUT_UNITS;
function WhatsAppField({id,value,onChange,rows=5,maxLength,placeholder,invalid}:{id?:string;value:string;onChange:(value:string)=>void;rows?:number;maxLength?:number;placeholder?:string;invalid?:boolean}){
  const ref=useRef<HTMLTextAreaElement>(null);const [emojiOpen,setEmojiOpen]=useState(false);
  function format(open:string,close=open){
    const el=ref.current;if(!el)return;
    const {selectionStart:from,selectionEnd:to,value:current}=el;const selected=current.slice(from,to)||'texto';
    onChange(current.slice(0,from)+open+selected+close+current.slice(to));
    requestAnimationFrame(()=>{el.focus();el.setSelectionRange(from+open.length,from+open.length+selected.length)});
  }
  function insertEmoji(emoji:string){
    const el=ref.current;const at=el?.selectionStart??value.length;
    onChange(value.slice(0,at)+emoji+value.slice(el?.selectionEnd??at));setEmojiOpen(false);
    requestAnimationFrame(()=>{el?.focus();el?.setSelectionRange(at+emoji.length,at+emoji.length)});
  }
  return <div className={`menu-message ${invalid?'invalid':''}`}>
    <textarea id={id} ref={ref} rows={rows} value={value} onChange={event=>onChange(event.target.value)} placeholder={placeholder} maxLength={maxLength}/>
    <div className="menu-format" role="toolbar" aria-label="Formatação do WhatsApp">
      <button type="button" title="Negrito" aria-label="Negrito" onClick={()=>format('*')}><Bold size={16}/></button>
      <button type="button" title="Itálico" aria-label="Itálico" onClick={()=>format('_')}><Italic size={16}/></button>
      <button type="button" title="Tachado" aria-label="Tachado" onClick={()=>format('~')}><Strikethrough size={16}/></button>
      <button type="button" title="Emoji" aria-label="Inserir emoji" aria-expanded={emojiOpen} onClick={()=>setEmojiOpen(open=>!open)}><Smile size={16}/></button>
      <button type="button" title="Monoespaçado" aria-label="Monoespaçado" onClick={()=>format('```')}><Code size={16}/></button>
      {emojiOpen&&<div className="menu-emoji" role="listbox" aria-label="Emojis">{MENU_EMOJIS.map(emoji=><button type="button" role="option" aria-selected="false" key={emoji} onClick={()=>insertEmoji(emoji)}>{emoji}</button>)}</div>}
    </div>
  </div>
}
const HTTPS_URL=/^https:\/\/\S+\.\S+/;
function MessageEditor({node,onSave,onCancel}:{node:FlowNode;onSave:(name:string,config:Record<string,unknown>)=>void;onCancel:()=>void}){
  const keyRef=useRef(0);const nextKey=()=>(keyRef.current+=1);
  const [name,setName]=useState(node.data.name);
  const [rows,setRows]=useState(()=>messageItemsOf(node.data.config).map(item=>({key:nextKey(),item})));
  const [submitted,setSubmitted]=useState(false);
  const full=rows.length>=MESSAGE_MAX_ITEMS;
  const add=(item:MessageItem)=>setRows(current=>current.length>=MESSAGE_MAX_ITEMS?current:[...current,{key:nextKey(),item}]);
  const patch=(index:number,change:Partial<MessageItem>)=>setRows(current=>current.map((row,i)=>i===index?{...row,item:{...row.item,...change} as MessageItem}:row));
  function move(index:number,delta:number){setRows(current=>{const to=index+delta;if(to<0||to>=current.length)return current;const next=[...current];[next[index],next[to]]=[next[to]!,next[index]!];return next})}
  const itemError=(item:MessageItem):string=>{
    if(item.type==='text')return !item.text.trim()?'Escreva o texto.':item.text.length>4096?'Use até 4096 caracteres.':!Number.isInteger(item.typingSeconds)||item.typingSeconds<0||item.typingSeconds>MESSAGE_MAX_TYPING_SECONDS?`Digitando: use de 0 a ${MESSAGE_MAX_TYPING_SECONDS} segundos.`:'';
    if(item.type==='pause')return ![item.minSeconds,item.maxSeconds].every(n=>Number.isInteger(n)&&n>=0&&n<=MESSAGE_MAX_PAUSE_SECONDS)?`Use de 0 a ${MESSAGE_MAX_PAUSE_SECONDS} segundos.`:item.minSeconds>item.maxSeconds?'O mínimo não pode passar do máximo.':'';
    if(!HTTPS_URL.test(item.url.trim()))return 'Informe uma URL HTTPS válida.';
    if(item.type==='file'&&!item.fileName.trim())return 'Informe o nome do arquivo.';
    return (item.caption??'').length>1024?'A legenda aceita até 1024 caracteres.':'';
  };
  const hasErrors=!rows.length||rows.length>MESSAGE_MAX_ITEMS||rows.some(row=>itemError(row.item));
  const show=(message:string)=>submitted&&message?<small className="field-error">{message}</small>:null;
  function save(){
    setSubmitted(true);if(hasErrors)return;
    const items=rows.map(({item})=>{
      if(item.type==='text')return {...item,text:item.text.trim()};
      if(item.type==='pause')return item;
      const caption=item.caption?.trim();const url=item.url.trim();
      if(item.type==='file')return {type:'file',url,fileName:item.fileName.trim(),...(caption?{caption}:{})};
      const audio=item.mediaType==='audio';
      return {type:'media',mediaType:item.mediaType,url,...(!audio&&caption?{caption}:{}),...(audio&&item.ptt?{ptt:true}:{})};
    });
    const {text:_text,...rest}=node.data.config;
    onSave(name.trim()||kindMeta.message.label,{...rest,items});
  }
  const addLabel=(label:string,item:MessageItem)=><button type="button" className="menu-add" onClick={()=>add(item)} disabled={full} title={full?`Limite de ${MESSAGE_MAX_ITEMS} conteúdos`:undefined}><Plus size={16} aria-hidden="true"/> {label}</button>;
  return <><header><span className="palette-icon message"><MessageSquare size={16} aria-hidden="true"/></span><div><small>BLOCO SELECIONADO</small><b>Mensagem</b></div></header>
  <div className="inspector-form menu-editor message-editor">
    <label>Nome do bloco<input value={name} onChange={event=>setName(event.target.value)} maxLength={120}/></label>
    <div className="menu-options-head"><b>Conteúdos ({rows.length}/{MESSAGE_MAX_ITEMS})</b></div>
    <div className="message-add">{addLabel('Texto',{type:'text',text:'',typingSeconds:0})}{addLabel('Arquivo',{type:'file',url:'',fileName:''})}{addLabel('Mídia',{type:'media',mediaType:'image',url:''})}{addLabel('Pausa',{type:'pause',minSeconds:1,maxSeconds:3})}</div>
    {rows.length===0&&<div className={`menu-options-empty ${submitted?'invalid':''}`}><MessageSquare size={26} aria-hidden="true"/><p>Adicione ao menos um conteúdo.</p></div>}
    <ol className="message-items">{rows.map(({key,item},index)=><li key={key}>
      <div className="message-item-head"><b>{index+1}. {item.type==='text'?'Texto':item.type==='file'?'Arquivo':item.type==='media'?'Mídia':'Pausa'}</b>
        <span><button type="button" aria-label={`Mover conteúdo ${index+1} para cima`} title="Subir" disabled={index===0} onClick={()=>move(index,-1)}><ChevronUp size={16}/></button><button type="button" aria-label={`Mover conteúdo ${index+1} para baixo`} title="Descer" disabled={index===rows.length-1} onClick={()=>move(index,1)}><ChevronDown size={16}/></button><button type="button" aria-label={`Remover conteúdo ${index+1}`} title="Remover" onClick={()=>setRows(current=>current.filter((_,i)=>i!==index))}><X size={16}/></button></span></div>
      {item.type==='text'&&<><WhatsAppField value={item.text} onChange={text=>patch(index,{text})} maxLength={4096} placeholder="Use {{variavel}} para personalizar." invalid={Boolean(submitted&&itemError(item))}/>
        <label>Digitando por (segundos)<input type="number" min="0" max={MESSAGE_MAX_TYPING_SECONDS} step="1" value={item.typingSeconds} onChange={event=>patch(index,{typingSeconds:Number(event.target.value)})}/></label></>}
      {item.type==='file'&&<><label>URL HTTPS do arquivo<input type="url" inputMode="url" value={item.url} onChange={event=>patch(index,{url:event.target.value})} placeholder="https://cdn.exemplo.com/arquivo.pdf"/></label><label>Nome do arquivo<input value={item.fileName} maxLength={255} onChange={event=>patch(index,{fileName:event.target.value})} placeholder="contrato.pdf"/></label><label>Legenda <span className="optional">(opcional)</span><textarea rows={2} value={item.caption??''} maxLength={1024} onChange={event=>patch(index,{caption:event.target.value})}/></label></>}
      {item.type==='media'&&<><label>Tipo<select value={item.mediaType} onChange={event=>patch(index,{mediaType:event.target.value as 'image'|'video'|'audio'})}>{(Object.keys(MEDIA_LABELS) as Array<keyof typeof MEDIA_LABELS>).map(type=><option key={type} value={type}>{MEDIA_LABELS[type]}</option>)}</select></label><label>URL HTTPS<input type="url" inputMode="url" value={item.url} onChange={event=>patch(index,{url:event.target.value})} placeholder="https://cdn.exemplo.com/midia"/></label>
        {item.mediaType!=='audio'&&<label>Legenda <span className="optional">(opcional)</span><textarea rows={2} value={item.caption??''} maxLength={1024} onChange={event=>patch(index,{caption:event.target.value})}/></label>}
        {item.mediaType==='audio'&&<label className="check-field"><input type="checkbox" checked={item.ptt===true} onChange={event=>patch(index,{ptt:event.target.checked})}/> Enviar como mensagem de voz</label>}</>}
      {item.type==='pause'&&<div className="duration-fields"><label>Entre (s)<input type="number" min="0" max={MESSAGE_MAX_PAUSE_SECONDS} step="1" value={item.minSeconds} onChange={event=>patch(index,{minSeconds:Number(event.target.value)})}/></label><label>e (s)<input type="number" min="0" max={MESSAGE_MAX_PAUSE_SECONDS} step="1" value={item.maxSeconds} onChange={event=>patch(index,{maxSeconds:Number(event.target.value)})}/></label></div>}
      {show(itemError(item))}
    </li>)}</ol>
    {show(!rows.length?'Adicione ao menos um conteúdo.':'')}
    <footer className="menu-actions"><button type="button" onClick={onCancel}>Cancelar</button><button type="button" className="primary" onClick={save}>Salvar</button></footer>
  </div></>
}
function MenuEditor({node,onSave,onCancel}:{node:FlowNode;onSave:(name:string,config:Record<string,unknown>)=>void;onCancel:()=>void}){
  const initial=node.data.config;
  const initialTimeout=Number(initial.timeoutSeconds??0);
  const initialUnit:TimeoutUnit=initialTimeout>0&&initialTimeout%86400!==0?(initialTimeout%3600===0?'hours':'minutes'):'days';
  const [name,setName]=useState(node.data.name);
  const [mode,setMode]=useState<MenuMode>(initial.mode==='buttons'?'buttons':'list');
  const [text,setText]=useState(String(initial.text??''));
  const [buttonText,setButtonText]=useState(String(initial.buttonText??''));
  const [timeoutValue,setTimeoutValue]=useState(initialTimeout/TIMEOUT_UNITS[initialUnit]);
  const [timeoutUnit,setTimeoutUnit]=useState<TimeoutUnit>(initialUnit);
  const [options,setOptions]=useState<MenuOption[]>(()=>menuOptionsOf(initial));
  const [saveAs,setSaveAs]=useState(String(initial.saveAs??''));
  const [footer,setFooter]=useState(String(initial.footer??''));
  const [imageEnabled,setImageEnabled]=useState(Boolean(initial.imageUrl));
  const [imageUrl,setImageUrl]=useState(String(initial.imageUrl??''));
  const [submitted,setSubmitted]=useState(false);
  const limit=MENU_LIMIT[mode];const labelMax=mode==='buttons'?20:24;const isButtons=mode==='buttons';
  const copy=isButtons?{heading:'Opções de Botões',add:'Adicionar Botão',empty:'Nenhum botão adicionado. Clique em “Adicionar Botão” para começar.',item:'botão'}:{heading:'Opções do Menu',add:'Adicionar Opção',empty:'Nenhuma opção adicionada. Clique em “Adicionar Opção” para começar.',item:'opção'};
  const timeoutSeconds=Math.max(0,Math.round(timeoutValue||0))*TIMEOUT_UNITS[timeoutUnit];

  const labels=options.map(option=>option.label.trim());
  const errors={
    text:!text.trim()?'Escreva a mensagem do menu.':text.length>1024?'Use até 1024 caracteres.':'',
    buttonText:mode==='list'&&!buttonText.trim()?'Informe o texto do botão que abre a lista.':'',
    image:isButtons&&imageEnabled?(!/^https:\/\/\S+\.\S+/.test(imageUrl.trim())?'Informe uma URL HTTPS válida para a imagem.':''):'',
    timeout:timeoutSeconds>MENU_MAX_TIMEOUT_SECONDS?'O limite é 31 dias no total.':'',
    options:!options.length?'Adicione ao menos uma opção.':options.length>limit?(mode==='buttons'?'Botões aceitam até 3 opções. Remova opções ou use Lista.':'A lista aceita até 10 opções.'):'',
    option:(index:number)=>!labels[index]?'Dê um texto para a opção.':labels[index]!.length>labelMax?`Até ${labelMax} caracteres.`:labels.indexOf(labels[index]!)!==index?'Já existe uma opção com este texto.':'',
    saveAs:saveAs.trim()&&!/^[A-Za-z_][\w.]*$/.test(saveAs.trim())?'Use letras, números, _ e pontos, começando por letra.':''
  };
  const hasErrors=Boolean(errors.text||errors.buttonText||errors.image||errors.timeout||errors.options||errors.saveAs||options.some((_,index)=>errors.option(index)));
  const show=(message:string)=>submitted&&message?<small className="field-error">{message}</small>:null;

  function addOption(){
    // Ids stay stable once created: exits on the canvas are keyed by them.
    const used=new Set(options.map(option=>option.id));let n=options.length+1;while(used.has(`option_${n}`))n+=1;
    setOptions([...options,{id:`option_${n}`,label:''}]);
  }
  const updateOption=(index:number,patch:Partial<MenuOption>)=>setOptions(options.map((option,itemIndex)=>itemIndex===index?{...option,...patch}:option));
  function save(){
    setSubmitted(true);if(hasErrors)return;
    const {buttonText:_buttonText,saveAs:_saveAs,footer:_footer,imageUrl:_imageUrl,...rest}=initial;
    onSave(name.trim()||kindMeta.buttons.label,{
      ...rest,mode,text,timeoutSeconds,
      ...(mode==='list'?{buttonText:buttonText.trim()}:{}),
      ...(isButtons&&footer.trim()?{footer:footer.trim()}:{}),
      ...(isButtons&&imageEnabled&&imageUrl.trim()?{imageUrl:imageUrl.trim()}:{}),
      ...(saveAs.trim()?{saveAs:saveAs.trim()}:{}),
      buttons:options.map(option=>({id:option.id,label:option.label.trim(),...(mode==='list'&&option.description?.trim()?{description:option.description.trim()}:{})}))
    });
  }

  return <><header><span className="palette-icon buttons"><List size={16} aria-hidden="true"/></span><div><small>BLOCO SELECIONADO</small><b>Menu</b></div></header>
  <div className="inspector-form menu-editor">
    <div className="menu-mode" role="radiogroup" aria-label="Formato do menu">
      <button type="button" role="radio" aria-checked={mode==='list'} className={mode==='list'?'active':''} onClick={()=>setMode('list')}><List size={15} aria-hidden="true"/> Lista</button>
      <button type="button" role="radio" aria-checked={mode==='buttons'} className={mode==='buttons'?'active':''} onClick={()=>setMode('buttons')}><Square size={15} aria-hidden="true"/> Botões</button>
    </div>
    {isButtons&&<div className={`menu-image ${imageEnabled?'open':''}`}>
      <label className="menu-image-toggle"><input type="checkbox" checked={imageEnabled} onChange={event=>setImageEnabled(event.target.checked)}/> Imagem <span>(opcional)</span></label>
      {imageEnabled&&<div className="menu-image-body">
        <label>URL HTTPS da imagem<input type="url" inputMode="url" value={imageUrl} onChange={event=>setImageUrl(event.target.value)} placeholder="https://cdn.exemplo.com/capa.jpg" aria-invalid={Boolean(submitted&&errors.image)}/>{show(errors.image)}</label>
        {/^https:\/\/\S+\.\S+/.test(imageUrl.trim())&&<img src={imageUrl.trim()} alt="Prévia da imagem do menu" loading="lazy"/>}
      </div>}
    </div>}
    <label>Nome do bloco<input value={name} onChange={event=>setName(event.target.value)} maxLength={120}/></label>
    <label htmlFor="menu-text">Mensagem *</label>
    <WhatsAppField id="menu-text" value={text} onChange={setText} maxLength={1024} placeholder={isButtons?"Ex: É isso que você quer?":"Ex: Selecione a melhor opção:"} invalid={Boolean(submitted&&errors.text)}/>
    {show(errors.text)}
    {isButtons&&<label>Rodapé <span className="optional">(opcional)</span><input value={footer} onChange={event=>setFooter(event.target.value)} maxLength={60} placeholder="Ex: Mensagem com Botão"/></label>}
    {mode==='list'&&<label>Texto do Botão *<input value={buttonText} onChange={event=>setButtonText(event.target.value)} maxLength={20} placeholder="Ex: Abrir lista de opções" aria-invalid={Boolean(submitted&&errors.buttonText)}/>{show(errors.buttonText)}</label>}
    <fieldset className="menu-timeout">
      <legend>Tempo de expiração do menu (saída por inatividade)</legend>
      <p className="field-help">Se 0, o padrão é 2 dias. Se definir um tempo, a saída por inatividade será exibida no fluxo. Limite máximo: 31 dias no total.</p>
      <div className="duration-fields">
        <input type="number" min="0" step="1" inputMode="numeric" aria-label="Tempo de expiração" value={timeoutValue} onChange={event=>setTimeoutValue(Math.max(0,Number(event.target.value)))}/>
        <select aria-label="Unidade de tempo" value={timeoutUnit} onChange={event=>setTimeoutUnit(event.target.value as TimeoutUnit)}><option value="minutes">Minutos</option><option value="hours">Horas</option><option value="days">Dias</option></select>
      </div>
      {show(errors.timeout)}
    </fieldset>
    <div className="menu-options-head"><b>{copy.heading}</b><button type="button" className="menu-add" onClick={addOption} disabled={options.length>=limit} title={options.length>=limit?`Limite de ${limit} opções no formato ${mode==='list'?'lista':'botões'}`:undefined}><Plus size={16} aria-hidden="true"/> {copy.add}</button></div>
    {options.length===0
      ? <div className={`menu-options-empty ${submitted&&errors.options?'invalid':''}`}><List size={26} aria-hidden="true"/><p>{copy.empty}</p></div>
      : <ol className="menu-options">{options.map((option,index)=><li key={option.id}>
          <span className="menu-option-index" aria-hidden="true">{index+1}</span>
          <div>
            <input aria-label={`Texto do ${copy.item} ${index+1}`} value={option.label} maxLength={labelMax} onChange={event=>updateOption(index,{label:event.target.value})} placeholder={isButtons?`Botão ${index+1}`:`Opção ${index+1}`} aria-invalid={Boolean(submitted&&errors.option(index))}/>
            {mode==='list'&&<input aria-label={`Descrição da opção ${index+1}`} value={option.description??''} maxLength={72} onChange={event=>updateOption(index,{description:event.target.value})} placeholder="Descrição (opcional)"/>}
            {show(errors.option(index))}
          </div>
          <button type="button" className="menu-option-remove" aria-label={`Remover opção ${index+1}`} title="Remover opção" onClick={()=>setOptions(options.filter((_,itemIndex)=>itemIndex!==index))}><X size={16}/></button>
        </li>)}</ol>}
    {show(errors.options)}
    <label>Campo para salvar a resposta do usuário<input value={saveAs} onChange={event=>setSaveAs(event.target.value)} placeholder="Ex.: escolha_menu" maxLength={120} aria-invalid={Boolean(submitted&&errors.saveAs)}/><small>Deixe em branco para não salvar a resposta.</small>{show(errors.saveAs)}</label>
    <footer className="menu-actions"><button type="button" onClick={onCancel}>Cancelar</button><button type="button" className="primary" onClick={save}>Salvar</button></footer>
  </div></>
}
type ConditionMember={id:string;name:string};
function ConditionValue({rule,tags,members,boards,pathInvalid,onChange}:{rule:ConditionRule;pathInvalid:boolean;tags:ContactMeta['tags'];members:ConditionMember[];boards:KanbanBoard[];onChange:(patch:Partial<ConditionRule>)=>void}){
  const item=itemForRule(rule);const kind=valueKind(item,rule.operator);
  const [draft,setDraft]=useState(String(rule.value??''));useEffect(()=>{setDraft(d=>coerceRuleValue(rule.operator,d)===rule.value?d:String(rule.value??''))},[rule.value,rule.operator]);
  const list=Array.isArray(rule.value)?rule.value as unknown[]:[];
  const toggle=(value:unknown)=>onChange({value:list.includes(value)?list.filter(entry=>entry!==value):[...list,value]});
  const pair=Array.isArray(rule.value)?rule.value as string[]:['',''];
  const setPair=(index:0|1,value:string)=>onChange({value:index===0?[value,pair[1]??'']:[pair[0]??'',value]});
  return <>
    {item.key==='custom'&&<label>Chave do campo<input value={rule.field.slice(CUSTOM_FIELD_PREFIX.length)} onChange={event=>onChange({field:CUSTOM_FIELD_PREFIX+event.target.value.trim()})} placeholder="Ex.: plano" aria-invalid={pathInvalid}/></label>}
    {item.key==='variable'&&<label>Caminho da variável<input value={rule.field} onChange={event=>onChange({field:event.target.value.trim()})} placeholder="Ex.: menu.choice" aria-invalid={pathInvalid}/></label>}
    {kind==='tags'&&(tags.length?<div className="condition-checks">{tags.map(tag=><label key={tag.id} className="check-field"><input type="checkbox" checked={list.includes(tag.id)} onChange={()=>toggle(tag.id)}/><i style={{background:tag.color}}/>{tag.name}</label>)}</div>:<p className="field-help">Nenhuma etiqueta cadastrada ainda.</p>)}
    {kind==='members'&&(members.length?<div className="condition-checks">{members.map(member=><label key={member.id} className="check-field"><input type="checkbox" checked={list.includes(member.id)} onChange={()=>toggle(member.id)}/>{member.name}</label>)}</div>:<p className="field-help">Nenhum membro no workspace.</p>)}
    {kind==='kanbanColumns'&&<><label>Quadro<select value={rule.field.split('.')[1]??''} onChange={event=>onChange({field:event.target.value?`kanban.${event.target.value}.columnId`:'kanban.',value:[]})}><option value="">Selecione…</option>{boards.map(board=><option value={board.id} key={board.id}>{board.name}</option>)}</select></label>{(()=>{const board=boards.find(item=>item.id===rule.field.split('.')[1]);return board?<div className="condition-checks">{board.columns.map(column=><label key={column.id} className="check-field"><input type="checkbox" checked={list.includes(column.id)} onChange={()=>toggle(column.id)}/><i style={{background:column.color}}/>{column.name}</label>)}</div>:null})()}</>}
    {kind==='weekdays'&&<div className="condition-weekdays" role="group" aria-label="Dias da semana">{WEEKDAY_LABELS.map((label,day)=><button type="button" key={label} aria-pressed={list.includes(day)} className={list.includes(day)?'active':''} onClick={()=>toggle(day)}>{label}</button>)}</div>}
    {kind==='timeRange'&&<><div className="duration-fields"><label>De<input type="time" value={pair[0]??''} onChange={event=>setPair(0,event.target.value)}/></label><label>Até<input type="time" value={pair[1]??''} onChange={event=>setPair(1,event.target.value)}/></label></div><p className="field-help">Se o início for depois do fim, vale a virada da noite (ex.: 22:00 até 06:00). Usa o fuso do workspace.</p></>}
    {kind==='date'&&<label>Data<input type="date" value={typeof rule.value==='string'?rule.value:''} onChange={event=>onChange({value:event.target.value})}/></label>}
    {kind==='dateRange'&&<div className="duration-fields"><label>De<input type="date" value={pair[0]??''} onChange={event=>setPair(0,event.target.value)}/></label><label>Até<input type="date" value={pair[1]??''} onChange={event=>setPair(1,event.target.value)}/></label></div>}
    {kind==='boolean'&&<label>Situação<select value={rule.value===false?'false':'true'} onChange={event=>onChange({value:event.target.value==='true'})}><option value="true">Dentro da janela de 24h</option><option value="false">Fora da janela de 24h</option></select></label>}
    {kind==='text'&&<label>Valor<input value={draft} onChange={event=>{setDraft(event.target.value);onChange({value:coerceRuleValue(rule.operator,event.target.value)})}}/></label>}
  </>
}
function ConditionEditor({node,tags,members,boards,onSave,onCancel}:{node:FlowNode;tags:ContactMeta['tags'];members:ConditionMember[];boards:KanbanBoard[];onSave:(name:string,config:Record<string,unknown>)=>void;onCancel:()=>void}){
  const initial=node.data.config;
  const [name,setName]=useState(node.data.name);
  const [logic,setLogic]=useState<'all'|'any'>(initial.logic==='any'?'any':'all');
  const [rules,setRules]=useState<ConditionRule[]>(()=>Array.isArray(initial.rules)?initial.rules as ConditionRule[]:[]);
  const [picking,setPicking]=useState(false);
  const [query,setQuery]=useState('');
  const [submitted,setSubmitted]=useState(false);
  const results=searchConditionItems(query);
  const errors=rules.map(ruleError);
  const listError=rules.length===0?'Adicione ao menos uma condição.':'';
  const updateRule=(index:number,patch:Partial<ConditionRule>)=>setRules(rules.map((rule,itemIndex)=>itemIndex===index?{...rule,...patch}:rule));
  function save(){setSubmitted(true);if(listError||errors.some(Boolean))return;onSave(name.trim()||kindMeta.condition.label,{...initial,logic,rules})}

  if(picking){const esc=(event:React.KeyboardEvent)=>{if(event.key==='Escape'){event.stopPropagation();setPicking(false)}};return <><header className="condition-picker-head" onKeyDown={esc}><button type="button" className="condition-back" aria-label="Voltar para as condições" onClick={()=>setPicking(false)}><ChevronLeft size={18}/></button><div><b>Adicionar condição ao fluxo</b><small>Defina as condições e regra lógica para que o fluxo continue pela saída superior deste bloco:</small></div></header>
  <div className="inspector-form condition-picker" onKeyDown={esc}>
    <label htmlFor="condition-search">Selecionar condição</label>
    <div className="condition-search"><Search size={16} aria-hidden="true"/><input id="condition-search" autoFocus type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar condição..."/></div>
    {results.length===0&&<p className="palette-empty">Nenhuma condição encontrada para “{query}”.</p>}
    {CONDITION_GROUPS.map(group=>{const items=results.filter(item=>item.group===group);return items.length?<section key={group} className={`condition-group group-${group.toLowerCase()}`}><b>{group}</b>{items.map(item=><button type="button" key={item.key} onClick={()=>{setRules([...rules,item.create()]);setPicking(false);setQuery('')}}>{item.label}</button>)}</section>:null})}
  </div></>}

  return <><header><span className="palette-icon condition"><GitBranch size={16} aria-hidden="true"/></span><div><small>BLOCO SELECIONADO</small><b>Editar Condicional</b></div></header>
  <div className="inspector-form condition-editor">
    <label>Nome do bloco<input value={name} onChange={event=>setName(event.target.value)} maxLength={120}/></label>
    <fieldset className="condition-logic"><legend>Regra Lógica</legend>
      <label className="radio-field"><input type="radio" name="condition-logic" checked={logic==='all'} onChange={()=>setLogic('all')}/> <span>Regra corresponde a <strong>todas</strong> as condições (e)</span></label>
      <label className="radio-field"><input type="radio" name="condition-logic" checked={logic==='any'} onChange={()=>setLogic('any')}/> <span>Regra corresponde a <strong>qualquer</strong> condição (ou)</span></label>
    </fieldset>
    <div className="menu-options-head"><b>Condições</b><button type="button" className="menu-add" onClick={()=>setPicking(true)} disabled={rules.length>=20} title={rules.length>=20?'Limite de 20 condições':undefined}><Plus size={16} aria-hidden="true"/> Adicionar Condição</button></div>
    {rules.length===0
      ? <div className={`menu-options-empty ${submitted&&listError?'invalid':''}`}><GitBranch size={26} aria-hidden="true"/><p>Nenhuma condição adicionada. Clique em “Adicionar Condição” para começar.</p></div>
      : <ol className="menu-options condition-rules">{rules.map((rule,index)=>{const item=itemForRule(rule);return <li key={index}>
          <span className="menu-option-index" aria-hidden="true">{index+1}</span>
          <div>
            <div className="condition-rule-head"><b>{item.label}</b><small>{item.group}</small></div>
            {item.operators.length>1&&<label>Operador<select value={rule.operator} onChange={event=>updateRule(index,{operator:event.target.value as ConditionOperator,...(valueKind(item,event.target.value as ConditionOperator)!==valueKind(item,rule.operator)?{value:item.create().value}:valueKind(item,rule.operator)==='text'?{value:coerceRuleValue(event.target.value as ConditionOperator,String(rule.value??''))}:{})})}>{item.operators.map(operator=><option key={operator.value} value={operator.value}>{operator.label}</option>)}</select></label>}
            <ConditionValue rule={rule} pathInvalid={Boolean(submitted&&/^Informe (a chave|o caminho)/.test(errors[index]??''))} tags={tags} members={members} boards={boards} onChange={patch=>updateRule(index,patch)}/>
            {submitted&&errors[index]&&<small className="field-error">{errors[index]}</small>}
          </div>
          <button type="button" className="menu-option-remove" aria-label={`Remover condição ${index+1}`} title="Remover condição" onClick={()=>setRules(rules.filter((_,itemIndex)=>itemIndex!==index))}><X size={16}/></button>
        </li>})}</ol>}
    {submitted&&listError&&<small className="field-error">{listError}</small>}
    <footer className="menu-actions"><button type="button" onClick={onCancel}>Cancelar</button><button type="button" className="primary" onClick={save}>Salvar</button></footer>
  </div></>
}
function EdgeInspector({edge,onChange,onRemove}:{edge:FlowEdge;onChange:(patch:Partial<FlowEdgeData>&{label?:string})=>void;onRemove:()=>void}){const condition=edge.data?.condition;const operator=condition?.operator??'equals';const needsValue=!['exists','not_exists'].includes(operator);return <><header><span className="palette-icon condition">→</span><div><small>CONEXÃO</small><b>Caminho do fluxo</b></div></header><div className="inspector-form"><label>Rótulo do caminho<input value={String(edge.label??'')} onChange={event=>onChange({label:event.target.value})} placeholder="Ex.: Sim, qualificado" /></label><label className="check-field"><input type="checkbox" checked={edge.data?.isDefault??false} onChange={event=>onChange({isDefault:event.target.checked,condition:event.target.checked?undefined:condition})}/> Rota padrão</label>{!edge.data?.isDefault&&<><label>Campo da condição<input value={condition?.field??''} onChange={event=>onChange({condition:{field:event.target.value,operator,value:condition?.value}})} placeholder="Ex.: lead.qualified"/></label><label>Operador<select value={operator} onChange={event=>onChange({condition:{field:condition?.field??'',operator:event.target.value as NonNullable<AutomationEdge['condition']>['operator'],value:condition?.value}})}><option value="equals">É igual a</option><option value="not_equals">É diferente de</option><option value="contains">Contém</option><option value="not_contains">Não contém</option><option value="exists">Existe</option><option value="not_exists">Não existe</option><option value="greater_than">Maior que</option><option value="less_than">Menor que</option></select></label>{needsValue&&<label>Valor<input value={String(condition?.value??'')} onChange={event=>onChange({condition:{field:condition?.field??'',operator,value:event.target.value}})}/></label>}</>}<label>Prioridade<input type="number" min="0" max="1000" step="1" value={edge.data?.priority??0} onChange={event=>onChange({priority:Number(event.target.value)})}/></label><p className="field-help">A primeira condição verdadeira é seguida; a rota padrão cobre os demais casos.</p><button className="danger-link" onClick={onRemove}>Excluir conexão</button></div></>}
function FlowInspector({definition,result,version,restoredVersion,versions,simulationVariables,onSimulationVariables,onRestore,onSettings,onSelectIssue}:{definition:AutomationDefinition;result:AutomationValidation|null;version:number;restoredVersion:number|null;versions:PlaybookVersion[];simulationVariables:string;onSimulationVariables:(value:string)=>void;onRestore:(version:PlaybookVersion)=>void;onSettings:(value:AutomationDefinition['settings'])=>void;onSelectIssue:(nodeId?:string,edgeId?:string)=>void}){return <><header><span className="palette-icon agent">◇</span><div><small>VISÃO GERAL</small><b>Configuração do fluxo</b></div></header><div className="flow-summary"><div><span>Versão</span><b>v{version}</b></div><div><span>Blocos</span><b>{definition.nodes.length}</b></div><div><span>Conexões</span><b>{definition.edges.length}</b></div></div><div className="inspector-form"><label>Máximo de passos<input type="number" min="1" max="100" value={definition.settings.maxSteps} onChange={event=>onSettings({...definition.settings,maxSteps:Number(event.target.value)})}/></label><label>Timeout (segundos)<input type="number" min="5" max="3600" value={definition.settings.timeoutSeconds} onChange={event=>onSettings({...definition.settings,timeoutSeconds:Number(event.target.value)})}/></label><label>Variáveis para simulação<textarea rows={6} spellCheck={false} value={simulationVariables} onChange={event=>onSimulationVariables(event.target.value)} placeholder={'{"contact":{"stage":"qualified"}}'}/><small>Objeto JSON usado nas condições e interpolações do teste.</small></label>{versions.length>0&&<div className="version-history"><b>Histórico de versões</b>{versions.map(item=><button type="button" key={item.id} className={restoredVersion===item.version?'active':''} onClick={()=>onRestore(item)}><span>v{item.version}{item.publishedAt?' · publicada':''}</span><small>{new Date(item.createdAt).toLocaleString('pt-BR')}</small></button>)}</div>}</div>{result&&<div className="validation-result"><h3>{result.valid?'✓ Fluxo válido':'Ajustes necessários'}</h3>{result.issues.length===0?<p>A simulação percorreu {result.simulation?.path.length??0} blocos e chegou ao final.</p>:result.issues.map((issue,index)=><button key={`${issue.code}-${index}`} className={issue.level} onClick={()=>onSelectIssue(issue.nodeId,issue.edgeId)}><span>{issue.level==='error'?'!':'△'}</span><span><b>{issue.level==='error'?'Erro':'Atenção'}</b><small>{issue.message}</small></span></button>)}{result.simulation&&<div className="simulation-path"><small>CAMINHO SIMULADO</small><div>{result.simulation.path.map((node,index)=><span key={`${node}-${index}`}>{index+1}</span>)}</div><p>{result.simulation.stoppedBecause==='completed'?'Execução concluída':result.simulation.stoppedBecause==='dead_end'?'Execução parou sem uma rota válida':'Limite de passos alcançado'}</p></div>}</div>}</>}
function errorMessage(error:unknown){return error instanceof ApiError?error.message:'Não foi possível concluir a ação. Tente novamente.'}
