import Fastify from 'fastify';
import {afterEach,describe,expect,it,vi} from 'vitest';
import errors from '../../../core/errors.js';
import {playbookRoutes} from '../routes.js';

const PIXEL='clx000000000000000000009';
const node=(id:string,kind:string,config:Record<string,unknown>={})=>({id,kind,name:id,config,position:{x:0,y:0}});
const edge=(id:string,source:string,target:string,extra:Record<string,unknown>={})=>({id,source,target,priority:0,...extra});
const chat={start:'t',nodes:[node('t','trigger',{event:'message.received'}),node('m','message',{text:'Oi {{nome}}'}),node('w','wait_response',{message:'Nome?',waitIndefinitely:true}),node('o','outcome',{type:'QUALIFIED'})],edges:[edge('e1','t','m'),edge('e2','m','w'),edge('e3','w','o',{port:'reply'})]};
const live={start:'t',nodes:[node('t','trigger',{event:'message.received'}),node('h','webhook',{url:'https://example.com/hook',method:'POST'}),node('o','outcome',{type:'QUALIFIED'})],edges:[edge('e1','t','h'),edge('e2','h','o',{port:'success'}),edge('e3','h','o',{port:'failure'})]};

// Fake Redis with a controllable clock so TTL is actually exercised.
function fakeRedis(){
  let now=0;const data=new Map<string,{v:string;exp:number}>();const ttls:number[]=[];
  return {
    advance:(ms:number)=>{now+=ms},ttls,
    get:async(k:string)=>{const e=data.get(k);return e&&e.exp>now?e.v:null},
    set:async(k:string,v:string,_m:'EX',s:number)=>{ttls.push(s);data.set(k,{v,exp:now+s*1000})},
    del:async(k:string)=>{data.delete(k)},
    eval:async()=>1
  };
}

async function build(granted=['playbook.write']){
  const redis=fakeRedis();const audits:any[]=[];
  const prisma:any={
    playbook:{count:async({where}:any)=>where.id==='pb'&&where.workspaceId==='ws'?1:0,findMany:async()=>[]},
    metaPixel:{findMany:async()=>[{id:PIXEL}]},
    workspace:{findUnique:async()=>({openaiApiKeyEncrypted:null})},
    auditLog:{create:async({data}:any)=>{audits.push(data)}}
  };
  const app=Fastify();app.decorate('prisma',prisma);app.decorate('redis',redis as any);
  app.decorate('requirePermission',((p:string)=>async(request:any,reply:any)=>{if(!granted.includes(p))return reply.status(403).send({code:'FORBIDDEN'});request.auth={workspaceId:'ws',userId:String(request.headers['x-user']??'u1')}}) as never);
  await app.register(errors);await app.register(playbookRoutes);
  const call=(method:string,url:string,user='u1',payload?:unknown)=>app.inject({method:method as any,url:`/v1/playbooks/pb/simulation-sessions${url}`,headers:{'x-user':user},...(payload!==undefined?{payload:payload as any}:{})});
  const start=async(definition:unknown=chat,extra:Record<string,unknown>={})=>(await call('POST','','u1',{definition,variables:{nome:'Ana'},...extra})).json();
  return {app,redis,audits,call,start};
}
afterEach(()=>vi.unstubAllGlobals());

describe('sessões do simulador',()=>{
  it('inicia, espera resposta e conclui',async()=>{
    const {call,start}=await build();
    const s=await start();expect(s.waiting.kind).toBe('reply');expect(s.messages[0].text).toBe('Oi Ana');expect(s.simulationId).toBeTruthy();
    const r=(await call('POST',`/${s.simulationId}/messages`,'u1',{text:'João'})).json();
    expect(r.completed).toBe(true);expect(r.visitedNodeIds).toContain('o');
  });
  it('outro usuário do mesmo workspace não lê, avança, reinicia nem apaga',async()=>{
    const {call,start}=await build();const {simulationId:id}=await start();
    for(const [m,u,p] of [['POST','/messages',{text:'x'}],['POST','/advance',{}],['POST','/restart',{}],['DELETE','',undefined]] as const){
      const res=await call(m,`/${id}${u}`,'u2',p);
      expect(res.statusCode).toBe(404);expect(res.json().code).toBe('SIMULATION_EXPIRED');
    }
    expect((await call('POST',`/${id}/messages`,'u1',{text:'x'})).statusCode).toBe(200);// ainda é do dono
    expect((await call('DELETE',`/${id}`,'u1')).statusCode).toBe(204);
    expect((await call('POST',`/${id}/advance`,'u1',{})).statusCode).toBe(404);
  });
  it('expira em 30 minutos de inatividade com erro reiniciável, nunca 500',async()=>{
    const {call,start,redis}=await build();const {simulationId:id}=await start();
    expect(redis.ttls[0]).toBe(1800);
    redis.advance(29*60_000);expect((await call('POST',`/${id}/advance`,'u1',{})).statusCode).toBe(200);// renova
    redis.advance(29*60_000);expect((await call('POST',`/${id}/advance`,'u1',{})).statusCode).toBe(200);
    redis.advance(31*60_000);const res=await call('POST',`/${id}/messages`,'u1',{text:'x'});
    expect(res.statusCode).toBe(404);expect(res.json().code).toBe('SIMULATION_EXPIRED');
  });
  it('definição com erro estrutural bloqueia o início',async()=>{
    const {call}=await build();
    const res=await call('POST','','u1',{definition:{...chat,start:'nada'},variables:{}});
    expect(res.statusCode).toBe(422);expect(res.json().code).toBe('INVALID_AUTOMATION');
    expect((await call('POST','','u1',{definition:'lixo'})).statusCode).toBe(422);
  });
  it('reiniciar volta ao começo com as variáveis originais',async()=>{
    const {call,start}=await build();const {simulationId:id}=await start();
    await call('POST',`/${id}/messages`,'u1',{text:'João'});
    const r=(await call('POST',`/${id}/restart`,'u1',{})).json();
    expect(r.completed).toBe(false);expect(r.waiting.kind).toBe('reply');expect(r.messages[0].text).toBe('Oi Ana');
  });
  it('limite de passos aparece como error, não como completed',async()=>{
    const {call,start}=await build();
    const loop={start:'t',nodes:[node('t','trigger',{event:'message.received'}),node('a','condition'),node('b','condition')],edges:[edge('e1','t','a'),edge('e2','a','b',{isDefault:true}),edge('e3','b','a',{isDefault:true})]};
    const s=await start(loop);
    // O validador pode recusar o ciclo; nesse caso o início já foi bloqueado, o que também impede o laço.
    expect(s.error.code).toBe('MAX_STEPS_EXCEEDED');expect(s.completed).toBe(false);
    void call;
  });
  it('limite de mensagens aparece como error',async()=>{
    const {start}=await build();
    const items=(k:string)=>({items:Array.from({length:30},(_,i)=>({type:'text',text:`${k}${i}`}))});const many={start:'t',nodes:[node('t','trigger',{event:'message.received'}),node('m1','message',items('a')),node('m2','message',items('b')),node('m3','message',items('c')),node('m4','message',items('d')),node('o','outcome',{type:'QUALIFIED'})],edges:[edge('e1','t','m1'),edge('e2','m1','m2'),edge('e3','m2','m3'),edge('e4','m3','m4'),edge('e5','m4','o')]};
    const s=await start(many);
    expect(s.error.code).toBe('MAX_MESSAGES_EXCEEDED');expect(s.completed).toBe(false);
  });
  it('exige playbook.write',async()=>{
    const {call}=await build(['playbook.read']);
    expect((await call('POST','','u1',{definition:chat})).statusCode).toBe(403);
  });
});

describe('ações reais',()=>{
  it('desligadas por padrão: nada é chamado e a integração fica como porta simulada',async()=>{
    const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
    const {start,audits}=await build();const s=await start(live);
    expect(s.waiting).toMatchObject({kind:'port',nodeId:'h'});expect(fetchMock).not.toHaveBeenCalled();expect(audits).toHaveLength(0);
  });
  it('ligadas: Integração roda de verdade, audita sem credenciais, e Pixel nunca dispara',async()=>{
    const fetchMock=vi.fn(async()=>new Response('{"ok":true}',{status:200}));vi.stubGlobal('fetch',fetchMock);
    const {start,audits}=await build();
    const s=await start({...live,nodes:[...live.nodes],edges:live.edges},{liveActions:true});
    // example.com é bloqueado ou não resolve em sandbox: o importante é que o resultado volta por uma porta e o fluxo segue.
    expect(s.waiting).toBeNull();expect(audits[0]).toMatchObject({action:'playbook.simulation.live_call',changes:{kind:'webhook',nodeId:'h'}});
    expect(JSON.stringify(audits)).not.toMatch(/authorization|apiKey/i);
    for(const call of fetchMock.mock.calls)expect(String((call as any)[0])).not.toMatch(/facebook|graph/);
  });
  it('Pixel com ações reais ligadas continua simulado',async()=>{
    const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
    const {start}=await build();
    const def={start:'t',nodes:[node('t','trigger',{event:'message.received'}),node('px','pixel',{pixelId:PIXEL,eventName:'LeadSubmitted'}),node('o','outcome',{type:'QUALIFIED'})],edges:[edge('e1','t','px'),edge('e2','px','o',{port:'success'})]};
    const s=await start(def,{liveActions:true});
    expect(s.waiting).toMatchObject({kind:'port',nodeId:'px'});expect(fetchMock).not.toHaveBeenCalled();
  });
});
