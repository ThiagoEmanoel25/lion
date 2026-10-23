import Fastify from 'fastify';
import {describe,expect,it} from 'vitest';
import errors from '../../core/errors.js';
import {playbookRoutes} from './routes.js';

type Row=Record<string,any>;
const matches=(row:Row,where:Row={})=>Object.entries(where).every(([key,value])=>{
  if(value&&typeof value==='object'&&'not' in value)return row[key]!==value.not;
  if(value&&typeof value==='object'&&'in' in value)return value.in.includes(row[key]);
  if(value&&typeof value==='object'&&!Array.isArray(value))return true;// relation filters are workspace scoping only
  return row[key]===value;
});

async function build(opts:{status?:string;executions?:number;slots?:Row[];keywords?:Row[];webhooks?:Row[];channels?:Row[];jumpFrom?:boolean}={}){
  const playbooks:Row[]=[
    {id:'pb',workspaceId:'ws-a',name:'Alvo',status:opts.status??'PUBLISHED',activeVersionId:'v1',archivedAt:null},
    {id:'pb-src',workspaceId:'ws-a',name:'Origem',status:'PUBLISHED',activeVersionId:'v9',activeVersion:{definition:{nodes:opts.jumpFrom?[{id:'j1',kind:'flow_jump',config:{targetPlaybookId:'pb'}},{id:'j2',kind:'flow_jump',config:{targetPlaybookId:'other'}}]:[]}}}
  ];
  const slots=opts.slots??[],keywords=opts.keywords??[],webhooks=opts.webhooks??[],channels=opts.channels??[],audits:Row[]=[];
  const tx={
    playbook:{
      findFirst:async({where}:{where:Row})=>playbooks.find(item=>matches(item,where))??null,
      findMany:async({where}:{where:Row})=>playbooks.filter(item=>matches(item,where)),
      count:async({where}:{where:Row})=>playbooks.filter(item=>matches(item,where)).length,
      update:async({where,data}:{where:Row;data:Row})=>Object.assign(playbooks.find(item=>item.id===where.id)!,data),
      updateMany:async({where,data}:{where:Row;data:Row})=>{const hit=playbooks.filter(item=>matches(item,where));hit.forEach(item=>Object.assign(item,data));return {count:hit.length}}
    },
    channelFlowConfig:{findMany:async()=>slots.map(item=>({...item,channel:{id:item.channelId,displayName:'Canal'}})),deleteMany:async()=>{const n=slots.length;slots.length=0;return {count:n}}},
    channelKeyword:{findMany:async()=>keywords.map(item=>({...item,channel:{id:item.channelId,displayName:'Canal'}})),deleteMany:async()=>{const n=keywords.length;keywords.length=0;return {count:n}}},
    inboundWebhookEndpoint:{findMany:async()=>webhooks.filter(item=>item.isActive),updateMany:async()=>{webhooks.forEach(item=>{item.isActive=false});return {count:webhooks.length}}},
    channel:{findMany:async()=>channels,updateMany:async()=>{channels.forEach(item=>{item.activePlaybookId=null});channels.length=0;return {count:0}}},
    execution:{count:async()=>opts.executions??0},
    auditLog:{create:async({data}:{data:Row})=>{audits.push(data)}}
  };
  const prisma={...tx,$transaction:async(fn:any)=>fn(tx)};
  const app=Fastify();app.decorate('prisma',prisma as never);
  app.decorate('requirePermission',((_permission:string)=>async(request:any)=>{request.auth={workspaceId:'ws-a',userId:'user-a'}}) as never);
  await app.register(errors);await app.register(playbookRoutes);
  return {app,playbooks,slots,keywords,webhooks,channels,audits};
}
const post=(app:any,url:string,body?:Row)=>app.inject({method:'POST',url,payload:body??{}});

describe('arquivar: matriz de transições',()=>{
  it.each(['DRAFT','PAUSED','PUBLISHED'])('%s -> ARCHIVED sem usos',async status=>{
    const {app,playbooks}=await build({status});
    const res=await post(app,'/v1/playbooks/pb/archive');
    expect(res.statusCode).toBe(200);
    expect(playbooks[0]).toMatchObject({status:'ARCHIVED',activeVersionId:null});
    expect(playbooks[0]!.archivedAt).toBeInstanceOf(Date);
  });
  it('ARCHIVED -> ARCHIVED é recusado',async()=>{
    const {app}=await build({status:'ARCHIVED'});
    expect((await post(app,'/v1/playbooks/pb/archive')).statusCode).toBe(409);
  });
  it('ARCHIVED -> DRAFT limpa archivedAt; outros estados não desarquivam',async()=>{
    const {app,playbooks}=await build({status:'ARCHIVED'});playbooks[0]!.archivedAt=new Date();
    expect((await post(app,'/v1/playbooks/pb/unarchive')).json()).toEqual({id:'pb',status:'DRAFT'});
    expect(playbooks[0]).toMatchObject({status:'DRAFT',archivedAt:null});
    expect((await post(app,'/v1/playbooks/pb/unarchive')).statusCode).toBe(409);
  });
  it('404 em fluxo de outro workspace ou inexistente',async()=>{
    const {app}=await build();
    expect((await post(app,'/v1/playbooks/nope/archive')).statusCode).toBe(404);
    expect((await post(app,'/v1/playbooks/nope/unarchive')).statusCode).toBe(404);
    expect((await app.inject({method:'GET',url:'/v1/playbooks/nope/archive-impact'})).statusCode).toBe(404);
  });
});

describe('arquivar: execuções e confirmação',()=>{
  it('execução ativa bloqueia com 409 mesmo com confirmDetach',async()=>{
    const {app,playbooks}=await build({executions:2});
    const res=await post(app,'/v1/playbooks/pb/archive',{confirmDetach:true});
    expect(res.statusCode).toBe(409);expect(res.json().code).toBe('PLAYBOOK_HAS_ACTIVE_EXECUTIONS');
    expect(playbooks[0]!.status).toBe('PUBLISHED');
  });
  it('usos sem confirmDetach: 409 com a lista completa e nada é removido',async()=>{
    const {app,slots,keywords,webhooks,playbooks}=await build({slots:[{id:'s1',slot:'WELCOME',channelId:'c1'}],keywords:[{id:'k1',keyword:'oi',match:'EXACT',channelId:'c1'}],webhooks:[{id:'w1',name:'Hook',isActive:true}],jumpFrom:true});
    const res=await post(app,'/v1/playbooks/pb/archive');
    expect(res.statusCode).toBe(409);expect(res.json().code).toBe('ARCHIVE_NEEDS_CONFIRMATION');
    expect(res.json().details).toMatchObject({slots:[{slot:'WELCOME'}],keywords:[{keyword:'oi'}],webhooks:[{id:'w1'}],flowJumps:[{playbookId:'pb-src',nodeId:'j1'}]});
    expect([slots.length,keywords.length,webhooks[0]!.isActive,playbooks[0]!.status]).toEqual([1,1,true,'PUBLISHED']);
  });
  it('só flow jump já exige confirmação (não é reescrito)',async()=>{
    const {app}=await build({jumpFrom:true});
    expect((await post(app,'/v1/playbooks/pb/archive')).statusCode).toBe(409);
  });
  it('confirmDetach remove slots/palavras/canal legado, desativa webhook e audita',async()=>{
    const {app,slots,keywords,webhooks,channels,playbooks,audits}=await build({slots:[{id:'s1',slot:'WELCOME',channelId:'c1'}],keywords:[{id:'k1',keyword:'oi',match:'EXACT',channelId:'c1'}],webhooks:[{id:'w1',name:'Hook',isActive:true}],channels:[{id:'c1',displayName:'Canal',activePlaybookId:'pb'}],jumpFrom:true});
    const res=await post(app,'/v1/playbooks/pb/archive',{confirmDetach:true});
    expect(res.statusCode).toBe(200);
    expect([slots.length,keywords.length,webhooks[0]!.isActive,channels.length,playbooks[0]!.status]).toEqual([0,0,false,0,'ARCHIVED']);
    expect(audits[0]).toMatchObject({action:'playbook.archived',targetId:'pb'});
    expect(playbooks[1]!.activeVersion.definition.nodes).toHaveLength(2);// jumps untouched
  });
});

describe('archive-impact',()=>{
  it('lista usos e execuções ativas sem alterar nada',async()=>{
    const {app,slots,playbooks}=await build({executions:3,slots:[{id:'s1',slot:'DEFAULT_RESPONSE',channelId:'c1'}],jumpFrom:true});
    const body=(await app.inject({method:'GET',url:'/v1/playbooks/pb/archive-impact'})).json();
    expect(body).toMatchObject({activeExecutions:3,slots:[{slot:'DEFAULT_RESPONSE',channelName:'Canal'}],flowJumps:[{nodeId:'j1'}],keywords:[],webhooks:[]});
    expect([slots.length,playbooks[0]!.status]).toEqual([1,'PUBLISHED']);
  });
});

describe('arquivado não pode ser usado',()=>{
  it('não publica, não pausa e não reativa',async()=>{
    const {app}=await build({status:'ARCHIVED'});
    expect((await post(app,'/v1/playbooks/pb/publish',{expectedVersion:1})).json().code).toBe('PLAYBOOK_ARCHIVED');
    expect((await post(app,'/v1/playbooks/pb/pause')).statusCode).toBe(409);
    expect((await post(app,'/v1/playbooks/pb/resume')).statusCode).toBe(409);
  });
});
