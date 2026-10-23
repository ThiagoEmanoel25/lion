import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {AutomationAiConfigSchema,AutomationWebhookConfigSchema} from '@nexo/contracts';
import {DomainError,createSimulation,renderTemplate,setContextPath,stepSimulation,type SimulationDefinition,type SimulationInput,type SimulationOptions,type SimulationPort,type SimulationState} from '@nexo/domain';
import {audit} from '../../../core/audit.js';
import {OpenAiProvider} from '../../ai/runtime.js';
import {decryptWebhookSecret} from '../../webhooks/generic.js';
import {integrationTestRateLimit,testIntegrationRequest} from '../integration-test.js';
import {createSessionStore,type SessionRedis,type SimulationSession} from './sessions.js';

const CreateInput=z.object({definition:z.unknown(),variables:z.record(z.unknown()).default({}),liveActions:z.boolean().default(false),confirmLiveActions:z.boolean().default(false)}).strict();
const MessageInput=z.union([
  z.object({text:z.string()}).strict(),
  z.object({optionId:z.string().min(1).max(200)}).strict(),
  z.object({port:z.object({nodeId:z.string().min(1).max(200),port:z.enum(['success','failure','reply','timeout'])}).strict()}).strict()
]);
const MAX_LIVE_CALLS_PER_REQUEST=10;

type Validate=(prisma:unknown,workspaceId:string,value:unknown)=>Promise<{valid:boolean;issues:unknown[];definition?:unknown}>;

const view=(state:SimulationState)=>({messages:state.messages,activeNodeId:state.activeNodeId,visitedNodeIds:state.visitedNodeIds,waiting:state.waiting,completed:state.completed,...(state.error?{error:state.error}:{})});

export function registerSimulationRoutes(app:FastifyInstance,validate:Validate,redis:SessionRedis=app.redis){
  const store=createSessionStore(redis);
  const guard={preHandler:[app.requirePermission('playbook.write')]};
  const base='/v1/playbooks/:id/simulation-sessions';

  const assertPlaybook=async(workspaceId:string,id:string)=>{if(!await app.prisma.playbook.count({where:{id,workspaceId}}))throw new DomainError('NOT_FOUND','Automação não encontrada.',404)};

  // Flow jumps read the active (published) definitions of the targets, same workspace only, and never write.
  // ponytail: reloads targets on every step; cache in the session if jump-heavy flows get slow.
  async function flowOptions(workspaceId:string,definition:SimulationDefinition):Promise<SimulationOptions>{
    const known=new Map<string,{definition:SimulationDefinition;name?:string}>();
    let pending=targetsOf(definition);
    for(let round=0;round<5&&pending.length;round++){
      const rows=await app.prisma.playbook.findMany({where:{workspaceId,id:{in:pending},status:{not:'ARCHIVED'},activeVersionId:{not:null}},select:{id:true,name:true,activeVersion:{select:{definition:true}}}}) as unknown as Array<{id:string;name:string;activeVersion:{definition:SimulationDefinition}|null}>;
      pending=[];
      for(const row of rows){if(!row.activeVersion||known.has(row.id))continue;known.set(row.id,{definition:row.activeVersion.definition,name:row.name});pending.push(...targetsOf(row.activeVersion.definition).filter(id=>!known.has(id)))}
    }
    return {loadFlow:id=>known.get(id)??null};
  }
  const targetsOf=(definition:SimulationDefinition)=>[...new Set(definition.nodes.flatMap(n=>n.kind==='flow_jump'&&typeof n.config?.targetPlaybookId==='string'?[n.config.targetPlaybookId]:[]))];

  // Only AI and Integração ever run for real. Pixel, WhatsApp, Venda and Notificação have no branch here and stay simulated.
  async function liveStep(auth:{workspaceId:string;userId:string},simulationId:string,state:SimulationState,options:SimulationOptions){
    for(let calls=0;calls<MAX_LIVE_CALLS_PER_REQUEST;calls++){
      const wait=state.waiting;
      if(wait?.kind!=='port'||state.error||state.completed)return state;
      const node=state.definition.nodes.find(n=>n.id===wait.nodeId);
      if(!node||(node.kind!=='ai'&&node.kind!=='webhook'))return state;
      await integrationTestRateLimit(app.redis,auth.userId);
      let port:SimulationPort='failure';let aiResponse:string|undefined;let context=state.context;let detail:Record<string,unknown>={};
      if(node.kind==='webhook'){
        const parsed=AutomationWebhookConfigSchema.safeParse(node.config??{});
        if(parsed.success){
          try{
            const result=await testIntegrationRequest({config:parsed.data,variables:state.context});
            if(result.ok){
              port='success';
              if(parsed.data.responseVariable)context=setContextPath(context,parsed.data.responseVariable,result.body);
              for(const field of parsed.data.responseFields)context=setContextPath(context,field.variable,field.path.split('.').reduce<unknown>((v,p)=>v&&typeof v==='object'?(v as Record<string,unknown>)[p]:undefined,result.body));
            }
            detail={status:result.status,durationMs:result.durationMs};
          }catch(error){detail={error:error instanceof Error?error.message.slice(0,200):'falha'}}
        }else detail={error:'configuração inválida'};
      }else{
        const config=AutomationAiConfigSchema.safeParse(node.config??{});
        const workspace=await app.prisma.workspace.findUnique({where:{id:auth.workspaceId},select:{openaiApiKeyEncrypted:true}});
        if(config.success&&workspace?.openaiApiKeyEncrypted){
          try{
            // The key stays on the server: it is decrypted here and never put in the session, the response or the audit.
            const provider=new OpenAiProvider(decryptWebhookSecret(workspace.openaiApiKeyEncrypted));
            const completion=await provider.complete({model:config.data.model,system:`${renderTemplate(config.data.systemPrompt,state.context)}\n\nResponda somente JSON com answer (string), confidence (0..1), shouldHandoff (boolean) e reason (string).`,message:renderTemplate(config.data.userMessage,state.context)});
            port='success';aiResponse=completion.text;
            await app.prisma.usageRecord.create({data:{workspaceId:auth.workspaceId,kind:'ai_tokens',quantity:completion.inputTokens+completion.outputTokens,unit:'token',costCents:completion.costCents,provider:'openai',referenceId:`simulation:${simulationId}`}});
            detail={inputTokens:completion.inputTokens,outputTokens:completion.outputTokens,costCents:completion.costCents};
          }catch(error){detail={error:error instanceof Error?error.message.slice(0,200):'falha'}}
        }else detail={error:config.success?'chave de IA não configurada':'configuração inválida'};
      }
      await audit(app.prisma,{workspaceId:auth.workspaceId,actorId:auth.userId,action:'playbook.simulation.live_call',targetType:'Playbook',targetId:simulationId,changes:{kind:node.kind,nodeId:node.id,port,...detail} as never});
      state=stepSimulation({...state,context},{kind:'port',nodeId:node.id,port},{...options,...(aiResponse!==undefined?{aiResponse}:{})});
    }
    return state;
  }

  async function advanceSession(request:{auth:{workspaceId:string;userId:string};params:unknown},input:SimulationInput|null,restart=false){
    const {id,simulationId}=request.params as {id:string;simulationId:string};
    const auth=request.auth;
    await assertPlaybook(auth.workspaceId,id);
    const session=await store.load(simulationId,{userId:auth.userId,workspaceId:auth.workspaceId,playbookId:id});
    let state=restart?createSimulation(session.definition,session.variables):session.state;
    const options=await flowOptions(auth.workspaceId,state.definition);
    if(restart)state=stepSimulation(state,{kind:'start'},options);else if(input)state=stepSimulation(state,input,options);
    if(session.liveActions)state=await liveStep(auth,simulationId,state,options);
    await store.save(simulationId,{...session,state});
    return view(state);
  }

  app.post(base,guard,async(request,reply)=>{
    const {id}=request.params as {id:string};
    await assertPlaybook(request.auth.workspaceId,id);
    const input=CreateInput.parse(request.body);
    if(input.liveActions&&!input.confirmLiveActions)throw new DomainError('LIVE_ACTIONS_CONFIRMATION_REQUIRED','Ações reais chamam IA e integrações de verdade e podem gerar custo. Confirme com confirmLiveActions:true.',422);
    const validation=await validate(app.prisma,request.auth.workspaceId,input.definition);
    if(!validation.valid||!validation.definition)throw new DomainError('INVALID_AUTOMATION','A automação possui erros.',422,validation.issues);
    const definition=validation.definition as SimulationDefinition;
    const session:SimulationSession={userId:request.auth.userId,workspaceId:request.auth.workspaceId,playbookId:id,liveActions:input.liveActions,definition,variables:input.variables,state:createSimulation(definition,input.variables)};
    const options=await flowOptions(request.auth.workspaceId,definition);
    session.state=stepSimulation(session.state,{kind:'start'},options);
    const simulationId=await store.create(session);
    // Persisted first so the id exists for cost and audit rows; the live loop then saves the final state.
    if(session.liveActions)session.state=await liveStep(request.auth,simulationId,session.state,options);
    await store.save(simulationId,session);
    return reply.status(201).send({simulationId,...view(session.state)});
  });

  app.post(`${base}/:simulationId/messages`,guard,async request=>{
    const body=MessageInput.parse(request.body);
    const input:SimulationInput='text' in body?{kind:'reply',text:body.text}:'optionId' in body?{kind:'choice',optionId:body.optionId}:{kind:'port',nodeId:body.port.nodeId,port:body.port.port};
    return advanceSession(request,input);
  });
  app.post(`${base}/:simulationId/advance`,guard,async request=>advanceSession(request,{kind:'advance'}));
  app.post(`${base}/:simulationId/restart`,guard,async request=>advanceSession(request,null,true));
  app.delete(`${base}/:simulationId`,guard,async(request,reply)=>{
    const {id,simulationId}=request.params as {id:string;simulationId:string};
    await assertPlaybook(request.auth.workspaceId,id);
    await store.load(simulationId,{userId:request.auth.userId,workspaceId:request.auth.workspaceId,playbookId:id});
    await store.remove(simulationId,request.auth.userId);
    return reply.status(204).send();
  });
}
