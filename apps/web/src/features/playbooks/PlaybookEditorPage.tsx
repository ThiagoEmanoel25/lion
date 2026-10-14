import {useCallback,useEffect,useMemo,useRef,useState,type DragEvent} from 'react';
import {Link,useParams} from 'react-router-dom';
import {Background,Controls,Handle,MarkerType,MiniMap,Position,ReactFlow,addEdge,applyEdgeChanges,applyNodeChanges,type Connection,type Edge,type EdgeChange,type Node,type NodeChange,type NodeProps,type ReactFlowInstance} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {ApiError} from '../../shared/api/client';
import type {AutomationDefinition,AutomationEdge,AutomationNodeKind,AutomationValidation,PlaybookVersion} from '../../shared/types/api';
import {usePlaybook,usePublishPlaybook,useSavePlaybookVersion,useSimulatePlaybook,useValidatePlaybook} from './api/queries';
import {useAgents} from '../agents/api/queries';
import type {AiAgent} from '../../shared/types/api';
import './flow-builder.css';

type FlowNodeData={kind:AutomationNodeKind;name:string;config:Record<string,unknown>};
type FlowNode=Node<FlowNodeData,'automation'>;
type FlowEdgeData={condition?:AutomationEdge['condition'];isDefault?:boolean;priority?:number};
type FlowEdge=Edge<FlowEdgeData>;

const catalog:Array<{kind:AutomationNodeKind;icon:string;label:string;description:string}>=[
  {kind:'trigger',icon:'⚡',label:'Gatilho',description:'Inicia o fluxo'},
  {kind:'message',icon:'▤',label:'Mensagem',description:'Envia texto no WhatsApp'},
  {kind:'image',icon:'▧',label:'Imagem',description:'Envia imagem com legenda'},
  {kind:'audio',icon:'◖',label:'Áudio',description:'Envia áudio ou mensagem de voz'},
  {kind:'sticker',icon:'◇',label:'Figurinha',description:'Envia uma figurinha'},
  {kind:'buttons',icon:'☷',label:'Botões',description:'Oferece até três escolhas'},
  {kind:'agent',icon:'✦',label:'Agente IA',description:'Interpreta e responde'},
  {kind:'condition',icon:'⑂',label:'Condição',description:'Cria caminhos de decisão'},
  {kind:'delay',icon:'◷',label:'Aguardar',description:'Pausa a execução'},
  {kind:'webhook',icon:'↗',label:'Webhook',description:'Chama um sistema externo'},
  {kind:'assign',icon:'◎',label:'Atribuir',description:'Define fila ou responsável'},
  {kind:'tag',icon:'#',label:'Etiqueta',description:'Organiza o contato'},
  {kind:'handoff',icon:'⇄',label:'Handoff',description:'Transfere para humano'},
  {kind:'outcome',icon:'✓',label:'Resultado',description:'Encerra com sucesso'}
];
const kindMeta=Object.fromEntries(catalog.map(item=>[item.kind,item])) as Record<AutomationNodeKind,(typeof catalog)[number]>;
const emptyDefinition:AutomationDefinition={start:'',nodes:[],edges:[],settings:{maxSteps:30,timeoutSeconds:300}};

function nodeSummary(kind:AutomationNodeKind,config:Record<string,unknown>){
  if(kind==='message'||kind==='buttons')return String(config.text??'');
  if(kind==='image')return String(config.caption||config.url||'Escolha uma imagem');
  if(kind==='audio')return config.ptt?'Mensagem de voz':String(config.url||'Escolha um áudio');
  if(kind==='sticker')return String(config.url||'Escolha uma figurinha');
  if(kind==='trigger')return String(config.event??'message.received').replace('message.received','Mensagem recebida').replace('tag.added','Etiqueta adicionada').replace('conversation.created','Conversa criada');
  if(kind==='delay')return `${Number(config.seconds??0)} segundos`;
  if(kind==='webhook')return `${String(config.method??'POST')} · ${String(config.url||'URL não definida')}`;
  if(kind==='assign'||kind==='handoff')return String(config.queue||config.assigneeId||'Destino não definido');
  if(kind==='tag')return String(config.tag||config.tagId||'Etiqueta não definida');
  if(kind==='agent')return config.agentId?'Agente configurado':'Selecione um agente';
  if(kind==='outcome')return String(config.type??'RESOLVED');
  return 'Configure as rotas nas conexões';
}
function flowAction(action:'duplicate'|'remove',id:string){window.dispatchEvent(new CustomEvent('nexo-flow-action',{detail:{action,id}}))}
function AutomationNodeCard({id,data,selected}:NodeProps<FlowNode>){const meta=kindMeta[data.kind];const terminal=data.kind==='outcome'||data.kind==='handoff';const buttonItems=data.kind==='buttons'&&Array.isArray(data.config.buttons)?data.config.buttons as Array<{id?:string;label?:string}>:[];return <div className={`automation-node automation-node-${data.kind} ${selected?'selected':''}`}>
  {data.kind!=='trigger'&&<Handle type="target" position={Position.Left} />}
  <div className="automation-node-head"><span className="automation-node-icon">{meta.icon}</span><span><small>{meta.label}</small><b>{data.name}</b></span><span className="node-quick-actions"><button title="Duplicar bloco" aria-label="Duplicar bloco" onClick={event=>{event.stopPropagation();flowAction('duplicate',id)}}>⧉</button><button title="Excluir bloco" aria-label="Excluir bloco" onClick={event=>{event.stopPropagation();flowAction('remove',id)}}>×</button></span></div>
  <p className="node-summary">{nodeSummary(data.kind,data.config)}</p>
  {data.kind==='buttons'&&buttonItems.length>0&&<div className="node-button-list">{buttonItems.map((button,index)=><div key={button.id||index}><span>{button.label||`Botão ${index+1}`}</span></div>)}</div>}
  {!terminal&&<Handle type="source" position={Position.Right} />}
</div>}
const nodeTypes={automation:AutomationNodeCard};

function normalizeDefinition(value:AutomationDefinition|undefined):AutomationDefinition{
  if(!value||!Array.isArray(value.nodes))return emptyDefinition;
  return {start:value.start||value.nodes[0]?.id||'',nodes:value.nodes.map((node,index)=>({...node,kind:node.kind||'message',name:node.name||`Etapa ${index+1}`,config:normalizeNodeConfig(node.kind,node.config),position:node.position??{x:100+index*220,y:180}})),edges:Array.isArray(value.edges)?value.edges:[],settings:{maxSteps:value.settings?.maxSteps??30,timeoutSeconds:value.settings?.timeoutSeconds??300}}
}
function toFlow(definition:AutomationDefinition){
  const nodes:FlowNode[]=definition.nodes.map(node=>({id:node.id,type:'automation',position:node.position,data:{kind:node.kind,name:node.name,config:node.config}}));
  const edges:FlowEdge[]=definition.edges.map(edge=>({id:edge.id,source:edge.source,target:edge.target,label:edge.label,data:{condition:edge.condition,isDefault:edge.isDefault??false,priority:edge.priority??0},type:'smoothstep',markerEnd:{type:MarkerType.ArrowClosed},animated:edge.label==='baixa confiança'}));
  return {nodes,edges}
}
function toDefinition(nodes:FlowNode[],edges:FlowEdge[],start:string,settings:AutomationDefinition['settings']):AutomationDefinition{return {start:nodes.some(node=>node.id===start)?start:(nodes.find(node=>node.data.kind==='trigger')?.id??nodes[0]?.id??''),nodes:nodes.map(node=>({id:node.id,kind:node.data.kind,name:node.data.name,config:node.data.config,position:node.position})),edges:edges.map(edge=>({id:edge.id,source:edge.source,target:edge.target,...(edge.label?{label:String(edge.label)}:{}),...(edge.data?.condition?{condition:edge.data.condition}:{}),isDefault:edge.data?.isDefault??false,priority:edge.data?.priority??0})),settings}}

export function PlaybookEditorPage(){
  const {id=''}=useParams();const playbook=usePlaybook(id);const agents=useAgents();const save=useSavePlaybookVersion();const validate=useValidatePlaybook();const simulate=useSimulatePlaybook();const publish=usePublishPlaybook();
  const [nodes,setNodes]=useState<FlowNode[]>([]);const [edges,setEdges]=useState<FlowEdge[]>([]);const [start,setStart]=useState('');const [settings,setSettings]=useState(emptyDefinition.settings);
  const [selectedNodeId,setSelectedNodeId]=useState<string|null>(null);const [selectedEdgeId,setSelectedEdgeId]=useState<string|null>(null);const [version,setVersion]=useState(0);const [loadedKey,setLoadedKey]=useState('');
  const [dirty,setDirty]=useState(false);const [result,setResult]=useState<AutomationValidation|null>(null);const [notice,setNotice]=useState<{tone:'success'|'error'|'info';text:string}|null>(null);const [simulationVariables,setSimulationVariables]=useState('{}');const [restoredVersion,setRestoredVersion]=useState<number|null>(null);const flowRef=useRef<ReactFlowInstance<FlowNode,FlowEdge>|null>(null);
  const latest=playbook.data?.versions?.[0];
  useEffect(()=>{if(!playbook.data||loadedKey.startsWith(`${playbook.data.id}:`))return;const definition=normalizeDefinition(latest?.definition);const flow=toFlow(definition);setNodes(flow.nodes);setEdges(flow.edges);setStart(definition.start);setSettings(definition.settings);setVersion(latest?.version??0);setLoadedKey(`${playbook.data.id}:${latest?.id??'empty'}`)},[playbook.data,latest,loadedKey]);
  const definition=useMemo(()=>toDefinition(nodes,edges,start,settings),[nodes,edges,start,settings]);
  const selectedNode=nodes.find(node=>node.id===selectedNodeId)??null;const selectedEdge=edges.find(edge=>edge.id===selectedEdgeId)??null;
  const busy=save.isPending||validate.isPending||simulate.isPending||publish.isPending;
  const mutateNodes=useCallback((changes:NodeChange<FlowNode>[])=>{setNodes(current=>applyNodeChanges(changes,current));setDirty(true);setResult(null)},[]);
  const mutateEdges=useCallback((changes:EdgeChange<FlowEdge>[])=>{setEdges(current=>applyEdgeChanges(changes,current));setDirty(true);setResult(null)},[]);
  const connect=useCallback((connection:Connection)=>{setEdges(current=>addEdge({...connection,id:crypto.randomUUID(),data:{isDefault:false,priority:0},type:'smoothstep',markerEnd:{type:MarkerType.ArrowClosed}},current));setDirty(true);setResult(null)},[]);
  function dragStart(event:DragEvent,kind:AutomationNodeKind){event.dataTransfer.setData('application/nexo-node',kind);event.dataTransfer.effectAllowed='move'}
  function drop(event:DragEvent){event.preventDefault();const kind=event.dataTransfer.getData('application/nexo-node') as AutomationNodeKind;if(!kindMeta[kind]||!flowRef.current)return;const position=flowRef.current.screenToFlowPosition({x:event.clientX,y:event.clientY});const id=crypto.randomUUID();const meta=kindMeta[kind];setNodes(current=>[...current,{id,type:'automation',position,data:{kind,name:meta.label,config:defaultConfig(kind)}}]);if(kind==='trigger'&&!start)setStart(id);setDirty(true);setSelectedNodeId(id);setSelectedEdgeId(null);setResult(null)}
  function updateSelected(patch:Partial<FlowNodeData>){if(!selectedNodeId)return;setNodes(current=>current.map(node=>node.id===selectedNodeId?{...node,data:{...node.data,...patch}}:node));setDirty(true);setResult(null)}
  function updateConfig(key:string,value:unknown){if(!selectedNode)return;updateSelected({config:{...selectedNode.data.config,[key]:value}})}
  function updateSelectedEdge(patch:Partial<FlowEdgeData>&{label?:string}){if(!selectedEdgeId)return;setEdges(current=>current.map(edge=>edge.id===selectedEdgeId?{...edge,...(patch.label!==undefined?{label:patch.label}:{}),data:{...edge.data,condition:patch.isDefault===true?undefined:(patch.condition??edge.data?.condition),isDefault:patch.isDefault??edge.data?.isDefault,priority:patch.priority??edge.data?.priority}}:edge));setDirty(true);setResult(null)}
  const removeNode=useCallback((nodeId:string)=>{setNodes(current=>current.filter(node=>node.id!==nodeId));setEdges(current=>current.filter(edge=>edge.source!==nodeId&&edge.target!==nodeId));setStart(current=>current===nodeId?'':current);setSelectedNodeId(current=>current===nodeId?null:current);setDirty(true);setResult(null)},[]);
  const duplicateNode=useCallback((nodeId:string)=>{setNodes(current=>{const source=current.find(node=>node.id===nodeId);if(!source)return current;const id=crypto.randomUUID();const copy:FlowNode={...source,id,selected:false,position:{x:source.position.x+45,y:source.position.y+75},data:{...source.data,name:`${source.data.name} (cópia)`,config:structuredClone(source.data.config)}};setSelectedNodeId(id);setSelectedEdgeId(null);return [...current,copy]});setDirty(true);setResult(null)},[]);
  useEffect(()=>{const handler=(event:Event)=>{const detail=(event as CustomEvent<{action:'duplicate'|'remove';id:string}>).detail;if(detail.action==='duplicate')duplicateNode(detail.id);else removeNode(detail.id)};window.addEventListener('nexo-flow-action',handler);return()=>window.removeEventListener('nexo-flow-action',handler)},[duplicateNode,removeNode]);
  function removeSelection(){if(selectedNodeId){setNodes(current=>current.filter(node=>node.id!==selectedNodeId));setEdges(current=>current.filter(edge=>edge.source!==selectedNodeId&&edge.target!==selectedNodeId));if(start===selectedNodeId)setStart('');setSelectedNodeId(null)}else if(selectedEdgeId){setEdges(current=>current.filter(edge=>edge.id!==selectedEdgeId));setSelectedEdgeId(null)}setDirty(true);setResult(null)}
  function parseSimulationVariables(){try{const parsed:unknown=JSON.parse(simulationVariables||'{}');if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw new Error();return parsed as Record<string,unknown>}catch{setNotice({tone:'error',text:'As variáveis da simulação precisam ser um objeto JSON válido.'});return null}}
  async function runValidation(){const variables=parseSimulationVariables();if(!variables)return null;try{const checked=await validate.mutateAsync({id,definition});if(!checked.valid){setResult(checked);setNotice({tone:'error',text:`${checked.issues.length} ponto(s) precisam de atenção.`});return checked}const simulated=await simulate.mutateAsync({id,definition,variables});const response:AutomationValidation={...simulated.validation,simulation:simulated.simulation};setResult(response);setNotice({tone:'success',text:'Fluxo válido. A simulação foi concluída.'});return response}catch(error){setNotice({tone:'error',text:errorMessage(error)});return null}}
  async function saveChanges(){try{const response=await save.mutateAsync({id,expectedVersion:version,definition});setVersion(response.version);setDirty(false);setNotice({tone:'success',text:`Versão ${response.version} salva com sucesso.`});return response.version}catch(error){setNotice({tone:'error',text:errorMessage(error)});return null}}
  function restoreLocal(item:PlaybookVersion){const restored=normalizeDefinition(item.definition);const flow=toFlow(restored);setNodes(flow.nodes);setEdges(flow.edges);setStart(restored.start);setSettings(restored.settings);setSelectedNodeId(null);setSelectedEdgeId(null);setResult(null);setRestoredVersion(item.version);setDirty(true);setNotice({tone:'info',text:`Versão ${item.version} carregada no editor. Salve para criar uma nova versão a partir dela.`});requestAnimationFrame(()=>flowRef.current?.fitView({padding:.25,duration:300}))}
  async function publishFlow(){const checked=await runValidation();if(!checked?.valid)return;const targetVersion=dirty?await saveChanges():version;if(targetVersion===null)return;try{await publish.mutateAsync({id,version:targetVersion});setNotice({tone:'success',text:`Versão ${targetVersion} publicada. As próximas conversas usarão este fluxo.`})}catch(error){setNotice({tone:'error',text:errorMessage(error)})}}
  if(playbook.isLoading)return <div className="flow-editor-state">Carregando editor…</div>;
  if(playbook.isError||!playbook.data)return <div className="flow-editor-state error"><h2>Não foi possível abrir este fluxo</h2><button onClick={()=>playbook.refetch()}>Tentar novamente</button></div>;
  return <div className="flow-editor-shell">
    <header className="flow-editor-header"><div className="flow-editor-title"><Link to="/playbooks" aria-label="Voltar">←</Link><div><small>FLUXOS / EDITOR</small><h1>{playbook.data.name}</h1></div><span className={playbook.data.status==='PUBLISHED'?'live':'draft'}>{playbook.data.status==='PUBLISHED'?'● Publicado':'Rascunho'}</span></div>
      <div className="flow-editor-actions"><span className={dirty?'unsaved':'saved'}>{dirty?'Alterações não salvas':`Versão ${version} salva`}</span><button onClick={runValidation} disabled={busy}>▷ Testar fluxo</button><button onClick={saveChanges} disabled={busy||!dirty}>Salvar versão</button><button className="primary" onClick={publishFlow} disabled={busy||nodes.length===0}>Publicar</button></div>
    </header>
    {notice&&<div className={`editor-notice ${notice.tone}`}><span>{notice.text}</span><button onClick={()=>setNotice(null)}>×</button></div>}
    <div className="flow-editor-body">
      <aside className="node-palette"><div><small>BLOCOS</small><p>Arraste para o canvas</p></div>{catalog.map(item=><button draggable onDragStart={event=>dragStart(event,item.kind)} key={item.kind}><span className={`palette-icon ${item.kind}`}>{item.icon}</span><span><b>{item.label}</b><small>{item.description}</small></span><i>⠿</i></button>)}<div className="palette-tip"><b>Dica</b><p>Ligue os blocos pelos pontos laterais. Use condições para ramificar a conversa.</p></div></aside>
      <section className="flow-canvas" onDrop={drop} onDragOver={event=>{event.preventDefault();event.dataTransfer.dropEffect='move'}}>
        <ReactFlow<FlowNode,FlowEdge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={mutateNodes} onEdgesChange={mutateEdges} onConnect={connect} onNodesDelete={deleted=>{const ids=new Set(deleted.map(node=>node.id));setEdges(current=>current.filter(edge=>!ids.has(edge.source)&&!ids.has(edge.target)));if(ids.has(start))setStart('');setSelectedNodeId(null)}} onInit={instance=>{flowRef.current=instance}} onNodeClick={(_,node)=>{setSelectedNodeId(node.id);setSelectedEdgeId(null)}} onEdgeClick={(_,edge)=>{setSelectedEdgeId(edge.id);setSelectedNodeId(null)}} onPaneClick={()=>{setSelectedNodeId(null);setSelectedEdgeId(null)}} deleteKeyCode={['Backspace','Delete']} fitView fitViewOptions={{padding:.25}} minZoom={.35} maxZoom={1.6}>
          <Background gap={22} size={1.2} color="#4a466d"/><MiniMap pannable zoomable nodeColor={node=>node.data.kind==='trigger'?'#20b958':node.data.kind==='condition'?'#23acd9':'#397af2'} maskColor="rgba(17,15,38,.72)"/><Controls showInteractive={false}/>
        </ReactFlow>
        {!nodes.length&&<div className="canvas-empty"><span>◇</span><b>Monte sua jornada</b><p>Arraste um gatilho para começar.</p></div>}
      </section>
      <aside className="flow-inspector">
        {selectedNode?<NodeInspector node={selectedNode} agents={agents.data??[]} agentsLoading={agents.isLoading} isStart={selectedNode.id===start} onName={name=>updateSelected({name})} onConfig={updateConfig} onStart={()=>{setStart(selectedNode.id);setDirty(true)}} onRemove={removeSelection}/>:selectedEdge?<EdgeInspector edge={selectedEdge} onChange={updateSelectedEdge} onRemove={removeSelection}/>:<FlowInspector definition={definition} result={result} version={version} restoredVersion={restoredVersion} versions={playbook.data.versions??[]} simulationVariables={simulationVariables} onSimulationVariables={setSimulationVariables} onRestore={restoreLocal} onSettings={next=>{setSettings(next);setDirty(true);setResult(null)}} onSelectIssue={(nodeId,edgeId)=>{if(nodeId){setSelectedNodeId(nodeId);setSelectedEdgeId(null);flowRef.current?.fitView({nodes:[{id:nodeId}],duration:250,padding:1})}else if(edgeId){setSelectedEdgeId(edgeId);setSelectedNodeId(null)}}}/>}
      </aside>
    </div>
  </div>
}

function defaultConfig(kind:AutomationNodeKind):Record<string,unknown>{
  switch(kind){
    case 'trigger':return {event:'message.received'};
    case 'message':return {text:'Olá! Como posso ajudar?'};
    case 'image':return {url:'',caption:''};
    case 'audio':return {url:'',ptt:true};
    case 'sticker':return {url:''};
    case 'buttons':return {text:'Escolha uma opção:',footer:'',buttons:[{id:'option_1',label:'Opção 1'}]};
    case 'agent':return {agentId:'',prompt:''};
    case 'condition':return {};
    case 'delay':return {seconds:300};
    case 'webhook':return {url:'',method:'POST'};
    case 'assign':return {queue:'Atendimento',assigneeId:''};
    case 'tag':return {tag:'qualificado',tagId:''};
    case 'handoff':return {queue:'Atendimento',reason:'Transferência solicitada pela automação.'};
    case 'outcome':return {type:'RESOLVED'};
  }
}
function normalizeNodeConfig(kind:AutomationNodeKind,value:Record<string,unknown>|undefined):Record<string,unknown>{
  const config={...(value??{})};
  if(kind==='agent'&&typeof config.prompt!=='string'&&typeof config.instructions==='string'){config.prompt=config.instructions;delete config.instructions}
  if(kind==='buttons'&&!Array.isArray(config.buttons))config.buttons=[{id:'option_1',label:'Opção 1'}];
  if(kind==='webhook'&&typeof config.method!=='string')config.method='POST';
  if(kind==='handoff'&&typeof config.queue!=='string'&&typeof config.team==='string'){config.queue=config.team;delete config.team}
  if(kind==='outcome'&&typeof config.type!=='string'){config.type=typeof config.outcome==='string'&&['QUALIFIED','APPOINTMENT','SALE','RESOLVED','HANDOFF','DISQUALIFIED'].includes(config.outcome.toUpperCase())?config.outcome.toUpperCase():'RESOLVED';delete config.outcome}
  return config
}
function NodeInspector({node,agents,agentsLoading,isStart,onName,onConfig,onStart,onRemove}:{node:FlowNode;agents:AiAgent[];agentsLoading:boolean;isStart:boolean;onName:(value:string)=>void;onConfig:(key:string,value:unknown)=>void;onStart:()=>void;onRemove:()=>void}){
  const kind=node.data.kind;const config=node.data.config;const buttons=Array.isArray(config.buttons)?config.buttons as Array<{id?:string;label?:string}>:[];
  const updateButton=(index:number,key:'id'|'label',value:string)=>onConfig('buttons',buttons.map((button,itemIndex)=>itemIndex===index?{...button,[key]:value}:button));
  return <><header><span className={`palette-icon ${kind}`}>{kindMeta[kind].icon}</span><div><small>BLOCO SELECIONADO</small><b>{kindMeta[kind].label}</b></div></header><div className="inspector-form">
    <label>Nome<input value={node.data.name} onChange={event=>onName(event.target.value)} /></label>
    {kind==='trigger'&&<label>Evento<select value={String(config.event??'message.received')} onChange={event=>onConfig('event',event.target.value)}><option value="message.received">Mensagem recebida</option><option value="tag.added">Etiqueta adicionada</option><option value="conversation.created">Conversa criada</option></select></label>}
    {kind==='message'&&<label>Mensagem<textarea rows={5} value={String(config.text??'')} onChange={event=>onConfig('text',event.target.value)} placeholder="Use {{variavel}} para personalizar." /></label>}
    {kind==='image'&&<><label>URL HTTPS da imagem<input type="url" value={String(config.url??'')} onChange={event=>onConfig('url',event.target.value)} placeholder="https://cdn.exemplo.com/imagem.jpg" /></label><label>Legenda opcional<textarea rows={3} value={String(config.caption??'')} onChange={event=>onConfig('caption',event.target.value)} placeholder="Use {{variavel}} para personalizar." /></label></>}
    {kind==='audio'&&<><label>URL HTTPS do áudio<input type="url" value={String(config.url??'')} onChange={event=>onConfig('url',event.target.value)} placeholder="https://cdn.exemplo.com/audio.ogg" /></label><label className="check-field"><input type="checkbox" checked={config.ptt===true} onChange={event=>onConfig('ptt',event.target.checked)}/> Enviar como mensagem de voz</label></>}
    {kind==='sticker'&&<><label>URL HTTPS da figurinha<input type="url" value={String(config.url??'')} onChange={event=>onConfig('url',event.target.value)} placeholder="https://cdn.exemplo.com/figurinha.webp" /></label><p className="field-help">Use WebP compatível com WhatsApp. O arquivo será enviado pelo canal Baileys.</p></>}
    {kind==='buttons'&&<><label>Texto da mensagem<textarea rows={4} value={String(config.text??'')} onChange={event=>onConfig('text',event.target.value)} placeholder="Escolha uma opção" /></label><label>Rodapé opcional<input value={String(config.footer??'')} onChange={event=>onConfig('footer',event.target.value)} maxLength={60}/></label><div className="button-config-list">{buttons.map((button,index)=><div key={index}><b>Botão {index+1}</b><input aria-label={`Identificador do botão ${index+1}`} value={button.id??''} onChange={event=>updateButton(index,'id',event.target.value)} placeholder="option_1"/><input aria-label={`Texto do botão ${index+1}`} value={button.label??''} maxLength={20} onChange={event=>updateButton(index,'label',event.target.value)} placeholder="Texto do botão"/><button type="button" onClick={()=>onConfig('buttons',buttons.filter((_,itemIndex)=>itemIndex!==index))} disabled={buttons.length===1}>Remover</button></div>)}</div><button type="button" className="add-button-option" onClick={()=>onConfig('buttons',[...buttons,{id:`option_${buttons.length+1}`,label:`Opção ${buttons.length+1}`}])} disabled={buttons.length>=3}>+ Adicionar botão</button><p className="field-help">Até três respostas rápidas. A captura da escolha será configurada em um bloco próprio.</p></>}
    {kind==='agent'&&<><label>Agente configurado<select value={String(config.agentId??'')} onChange={event=>onConfig('agentId',event.target.value)} disabled={agentsLoading}><option value="">{agentsLoading?'Carregando agentes…':'Selecione um agente'}</option>{agents.filter(agent=>agent.isActive).map(agent=><option key={agent.id} value={agent.id}>{agent.name} · {agent.model}</option>)}</select></label>{!agentsLoading&&!agents.some(agent=>agent.isActive)&&<p className="field-help">Crie e ative um agente no módulo Agentes de IA antes de publicar.</p>}<label>Instrução adicional do bloco<textarea rows={4} value={String(config.prompt??'')} onChange={event=>onConfig('prompt',event.target.value)} placeholder="Opcional: contexto específico desta etapa." /></label><p className="field-help">Objetivo, tom, confiança e handoff são controlados pelo agente selecionado.</p></>}
    {kind==='condition'&&<div className="config-callout"><b>Configure as rotas nas conexões</b><p>Selecione cada saída no canvas para definir condição, rota padrão e prioridade.</p></div>}
    {kind==='delay'&&<label>Tempo em segundos<input type="number" min="1" max="2592000" step="1" value={Number(config.seconds??300)} onChange={event=>onConfig('seconds',Number(event.target.value))}/><small>Entre 1 segundo e 30 dias.</small></label>}
    {kind==='webhook'&&<><label>URL HTTPS<input type="url" value={String(config.url??'')} onChange={event=>onConfig('url',event.target.value)} placeholder="https://api.exemplo.com/webhook" /></label><label>Método HTTP<select value={String(config.method??'POST')} onChange={event=>onConfig('method',event.target.value)}><option value="POST">POST</option><option value="PUT">PUT</option><option value="PATCH">PATCH</option><option value="DELETE">DELETE</option></select></label></>}
    {kind==='assign'&&<><label>Fila<input value={String(config.queue??'')} onChange={event=>onConfig('queue',event.target.value)} placeholder="Ex.: Comercial" /></label><div className="config-separator"><span>ou</span></div><label>ID do responsável<input value={String(config.assigneeId??'')} onChange={event=>onConfig('assigneeId',event.target.value)} placeholder="ID do usuário no workspace" /></label><p className="field-help">Preencha ao menos uma fila ou um responsável.</p></>}
    {kind==='tag'&&<><label>Nome da etiqueta<input value={String(config.tag??'')} onChange={event=>onConfig('tag',event.target.value)} placeholder="Ex.: qualificado" /></label><div className="config-separator"><span>ou</span></div><label>ID de etiqueta existente<input value={String(config.tagId??'')} onChange={event=>onConfig('tagId',event.target.value)} placeholder="ID da etiqueta no workspace" /></label><p className="field-help">Se houver ID, ele tem prioridade; sem ID, a etiqueta será criada pelo nome.</p></>}
    {kind==='handoff'&&<><label>Fila de destino<input value={String(config.queue??'')} onChange={event=>onConfig('queue',event.target.value)} placeholder="Ex.: Atendimento" /></label><label>Motivo<textarea rows={4} value={String(config.reason??'')} onChange={event=>onConfig('reason',event.target.value)} placeholder="Explique por que a conversa será transferida." /></label></>}
    {kind==='outcome'&&<><label>Tipo de resultado<select value={String(config.type??'RESOLVED')} onChange={event=>onConfig('type',event.target.value)}><option value="QUALIFIED">Lead qualificado</option><option value="APPOINTMENT">Agendamento</option><option value="SALE">Venda</option><option value="RESOLVED">Atendimento resolvido</option><option value="HANDOFF">Transferência humana</option><option value="DISQUALIFIED">Lead desqualificado</option></select></label><label>Valor em centavos (opcional)<input type="number" min="0" step="1" value={typeof config.valueCents==='number'?config.valueCents:''} onChange={event=>onConfig('valueCents',event.target.value===''?undefined:Number(event.target.value))} placeholder="Ex.: 15000" /></label></>}
    <button className={isStart?'start active':'start'} onClick={onStart} disabled={isStart||kind!=='trigger'}>{isStart?'✓ Nó inicial do fluxo':kind==='trigger'?'Definir como nó inicial':'Somente um gatilho pode iniciar'}</button><button className="danger-link" onClick={onRemove}>Excluir bloco</button>
  </div></>
}
function EdgeInspector({edge,onChange,onRemove}:{edge:FlowEdge;onChange:(patch:Partial<FlowEdgeData>&{label?:string})=>void;onRemove:()=>void}){const condition=edge.data?.condition;const operator=condition?.operator??'equals';const needsValue=!['exists','not_exists'].includes(operator);return <><header><span className="palette-icon condition">→</span><div><small>CONEXÃO</small><b>Caminho do fluxo</b></div></header><div className="inspector-form"><label>Rótulo do caminho<input value={String(edge.label??'')} onChange={event=>onChange({label:event.target.value})} placeholder="Ex.: Sim, qualificado" /></label><label className="check-field"><input type="checkbox" checked={edge.data?.isDefault??false} onChange={event=>onChange({isDefault:event.target.checked,condition:event.target.checked?undefined:condition})}/> Rota padrão</label>{!edge.data?.isDefault&&<><label>Campo da condição<input value={condition?.field??''} onChange={event=>onChange({condition:{field:event.target.value,operator,value:condition?.value}})} placeholder="Ex.: lead.qualified"/></label><label>Operador<select value={operator} onChange={event=>onChange({condition:{field:condition?.field??'',operator:event.target.value as NonNullable<AutomationEdge['condition']>['operator'],value:condition?.value}})}><option value="equals">É igual a</option><option value="not_equals">É diferente de</option><option value="contains">Contém</option><option value="not_contains">Não contém</option><option value="exists">Existe</option><option value="not_exists">Não existe</option><option value="greater_than">Maior que</option><option value="less_than">Menor que</option></select></label>{needsValue&&<label>Valor<input value={String(condition?.value??'')} onChange={event=>onChange({condition:{field:condition?.field??'',operator,value:event.target.value}})}/></label>}</>}<label>Prioridade<input type="number" min="0" max="1000" step="1" value={edge.data?.priority??0} onChange={event=>onChange({priority:Number(event.target.value)})}/></label><p className="field-help">A primeira condição verdadeira é seguida; a rota padrão cobre os demais casos.</p><button className="danger-link" onClick={onRemove}>Excluir conexão</button></div></>}
function FlowInspector({definition,result,version,restoredVersion,versions,simulationVariables,onSimulationVariables,onRestore,onSettings,onSelectIssue}:{definition:AutomationDefinition;result:AutomationValidation|null;version:number;restoredVersion:number|null;versions:PlaybookVersion[];simulationVariables:string;onSimulationVariables:(value:string)=>void;onRestore:(version:PlaybookVersion)=>void;onSettings:(value:AutomationDefinition['settings'])=>void;onSelectIssue:(nodeId?:string,edgeId?:string)=>void}){return <><header><span className="palette-icon agent">◇</span><div><small>VISÃO GERAL</small><b>Configuração do fluxo</b></div></header><div className="flow-summary"><div><span>Versão</span><b>v{version}</b></div><div><span>Blocos</span><b>{definition.nodes.length}</b></div><div><span>Conexões</span><b>{definition.edges.length}</b></div></div><div className="inspector-form"><label>Máximo de passos<input type="number" min="1" max="100" value={definition.settings.maxSteps} onChange={event=>onSettings({...definition.settings,maxSteps:Number(event.target.value)})}/></label><label>Timeout (segundos)<input type="number" min="5" max="3600" value={definition.settings.timeoutSeconds} onChange={event=>onSettings({...definition.settings,timeoutSeconds:Number(event.target.value)})}/></label><label>Variáveis para simulação<textarea rows={6} spellCheck={false} value={simulationVariables} onChange={event=>onSimulationVariables(event.target.value)} placeholder={'{"contact":{"stage":"qualified"}}'}/><small>Objeto JSON usado nas condições e interpolações do teste.</small></label>{versions.length>0&&<div className="version-history"><b>Histórico de versões</b>{versions.map(item=><button type="button" key={item.id} className={restoredVersion===item.version?'active':''} onClick={()=>onRestore(item)}><span>v{item.version}{item.publishedAt?' · publicada':''}</span><small>{new Date(item.createdAt).toLocaleString('pt-BR')}</small></button>)}</div>}</div>{result&&<div className="validation-result"><h3>{result.valid?'✓ Fluxo válido':'Ajustes necessários'}</h3>{result.issues.length===0?<p>A simulação percorreu {result.simulation?.path.length??0} blocos e chegou ao final.</p>:result.issues.map((issue,index)=><button key={`${issue.code}-${index}`} className={issue.level} onClick={()=>onSelectIssue(issue.nodeId,issue.edgeId)}><span>{issue.level==='error'?'!':'△'}</span><span><b>{issue.level==='error'?'Erro':'Atenção'}</b><small>{issue.message}</small></span></button>)}{result.simulation&&<div className="simulation-path"><small>CAMINHO SIMULADO</small><div>{result.simulation.path.map((node,index)=><span key={`${node}-${index}`}>{index+1}</span>)}</div><p>{result.simulation.stoppedBecause==='completed'?'Execução concluída':result.simulation.stoppedBecause==='dead_end'?'Execução parou sem uma rota válida':'Limite de passos alcançado'}</p></div>}</div>}</>}
function errorMessage(error:unknown){return error instanceof ApiError?error.message:'Não foi possível concluir a ação. Tente novamente.'}
