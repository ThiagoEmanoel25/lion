import {readFileSync} from 'node:fs';
import Fastify from 'fastify';
import {afterEach,describe,expect,it,vi} from 'vitest';
import errors from '../../../core/errors.js';
import {playbookRoutes} from '../routes.js';
import {encryptWebhookSecret} from '../../webhooks/generic.js';
process.env.FIELD_ENCRYPTION_KEY=Buffer.alloc(32,9).toString('base64');

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

async function build(granted=['playbook.write'],opts:{timezone?:string;targets?:any[];globals?:any[]}={}){
  const redis=fakeRedis();const audits:any[]=[];
  const prisma:any={
    playbook:{count:async({where}:any)=>where.id==='pb'&&where.workspaceId==='ws'?1:0,findMany:async({where}:any)=>(opts.targets??[]).filter(t=>where.id.in.includes(t.id)&&(!where.status||t.status!=='ARCHIVED'))},
    globalVariable:{findMany:async({where}:any)=>(opts.globals??[]).filter(row=>where.sensitive===undefined||row.sensitive===where.sensitive)},
    metaPixel:{findMany:async()=>[{id:PIXEL}]},
    workspace:{findUnique:async()=>({openaiApiKeyEncrypted:null,timezone:opts.timezone??'America/Bahia'})},
    auditLog:{create:async({data}:any)=>{audits.push(data)}}
  };
  const app=Fastify();app.decorate('prisma',prisma);app.decorate('redis',redis as any);
  app.decorate('requirePermission',((p:string)=>async(request:any,reply:any)=>{if(!granted.includes(p))return reply.status(403).send({code:'FORBIDDEN'});request.auth={workspaceId:'ws',userId:String(request.headers['x-user']??'u1')}}) as never);
  await app.register(errors);await app.register(playbookRoutes);
  const call=(method:string,url:string,user='u1',payload?:unknown)=>app.inject({method:method as any,url:`/v1/playbooks/pb/simulation-sessions${url}`,headers:{'x-user':user},...(payload!==undefined?{payload:payload as any}:{})});
  const start=async(definition:unknown=chat,extra:Record<string,unknown>={})=>(await call('POST','','u1',{definition,variables:{nome:'Ana'},...extra})).json();
  return {app,redis,audits,call,start};
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()});

describe('fuso do workspace e saltos para fluxos arquivados',()=>{
  const days=[0,1,2,3,4,5,6].map(day=>({day,enabled:day>=1&&day<=5,start:'09:00',end:'18:00'}));
  const delayFlow={start:'t',nodes:[node('t','trigger',{event:'message.received'}),node('d','delay',{mode:'schedule',days}),node('o','outcome',{type:'QUALIFIED'})],edges:[edge('e1','t','d'),edge('e2','d','o')]};
  const resume=async(timezone:string)=>{
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-24T15:00:00Z'));// sábado
    const {start}=await build(['playbook.write'],{timezone});return (await start(delayFlow)).waiting.resumeAt;
  };
  it('usa o fuso do workspace, não o padrão, para prever a espera',async()=>{
    expect(await resume('America/Manaus')).toBe('2026-10-26T13:00:00.000Z');// 09:00 -04
    expect(await resume('America/Bahia')).toBe('2026-10-26T12:00:00.000Z');// 09:00 -03
  });
  const jump=(target:string)=>({start:'t',nodes:[node('t','trigger',{event:'message.received'}),node('j','flow_jump',{targetPlaybookId:target})],edges:[edge('e1','t','j')]});
  const CLX='clx000000000000000000001';
  it('salto para fluxo inexistente continua sendo erro; para arquivado vira aviso e salva',async()=>{
    const {call}=await build(['playbook.write'],{targets:[{id:CLX,status:'ARCHIVED'}]});
    const body=(def:unknown)=>({definition:def,variables:{}});
    const missing=await call('POST','','u1',body(jump('clx000000000000000000002')));
    expect(missing.statusCode).toBe(422);
    expect(JSON.stringify(missing.json())).toContain('FLOW_JUMP_TARGET_NOT_FOUND');
    expect((await call('POST','','u1',body(jump(CLX)))).statusCode).not.toBe(422);
  });
});

describe('sessões do simulador',()=>{
  it('carrega globais não sensíveis e bloqueia sobrescrita de segredo',async()=>{
    const globals=[{normalizedName:'link',valueEncrypted:encryptWebhookSecret('https://real.test'),sensitive:false},{normalizedName:'token',valueEncrypted:encryptWebhookSecret('segredo'),sensitive:true}];
    const flow={start:'t',nodes:[node('t','trigger',{event:'message.received'}),node('m','message',{text:'{{global.link}}'})],edges:[edge('e','t','m')]};const {call}=await build(['playbook.write'],{globals});
    const ok=await call('POST','','u1',{definition:flow,variables:{global:{link:'https://override.test'}}});expect(ok.statusCode).toBe(201);expect(ok.json().messages[0].text).toBe('https://override.test');
    const blocked=await call('POST','','u1',{definition:flow,variables:{global:{token:'falso'}}});expect(blocked.statusCode).toBe(422);expect(blocked.json().code).toBe('SENSITIVE_GLOBAL_OVERRIDE');
  });
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
    const s=await start({...live,nodes:[...live.nodes],edges:live.edges},{liveActions:true,confirmLiveActions:true});
    // example.com é bloqueado ou não resolve em sandbox: o importante é que o resultado volta por uma porta e o fluxo segue.
    expect(s.waiting).toBeNull();expect(audits[0]).toMatchObject({action:'playbook.simulation.live_call',changes:{kind:'webhook',nodeId:'h'}});
    expect(JSON.stringify(audits)).not.toMatch(/authorization|apiKey/i);
    for(const call of fetchMock.mock.calls)expect(String((call as any)[0])).not.toMatch(/facebook|graph/);
  });
  it('Pixel com ações reais ligadas continua simulado',async()=>{
    const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
    const {start}=await build();
    const def={start:'t',nodes:[node('t','trigger',{event:'message.received'}),node('px','pixel',{pixelId:PIXEL,eventName:'LeadSubmitted'}),node('o','outcome',{type:'QUALIFIED'})],edges:[edge('e1','t','px'),edge('e2','px','o',{port:'success'})]};
    const s=await start(def,{liveActions:true,confirmLiveActions:true});
    expect(s.waiting).toMatchObject({kind:'port',nodeId:'px'});expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('limites e confirmação',()=>{
  it('liveActions sem confirmLiveActions é recusado',async()=>{
    const {call}=await build();
    const res=await call('POST','','u1',{definition:chat,liveActions:true});
    expect(res.statusCode).toBe(422);expect(res.json().code).toBe('LIVE_ACTIONS_CONFIRMATION_REQUIRED');
  });
  it('limita sessões abertas por usuário (descarta a mais antiga), libera ao apagar e ao expirar',async()=>{
    const {call,start,redis}=await build();
    const ids:string[]=[];for(let i=0;i<5;i++)ids.push((await start()).simulationId);
    const over=await call('POST','','u1',{definition:chat});expect(over.statusCode).toBe(201);// evicts the oldest instead of 429
    expect((await call('POST',`/${ids[0]}/messages`,'u1',{text:'x'})).json().code).toBe('SIMULATION_EXPIRED');expect((await call('POST',`/${ids[1]}/advance`,'u1')).statusCode).not.toBe(404);
    expect((await call('POST','','u2',{definition:chat})).statusCode).toBe(201);// outro usuário não é afetado
    await call('DELETE',`/${ids[1]}`,'u1');expect((await call('POST','','u1',{definition:chat})).statusCode).toBe(201);
    redis.advance(31*60_000);expect((await call('POST','','u1',{definition:chat})).statusCode).toBe(201);
  });
  it('guarda a definição uma vez e a restaura ao carregar',async()=>{
    const {call,start,redis}=await build();const {simulationId:id}=await start();
    const raw=await redis.get(`simulation:${id}`);expect(JSON.parse(raw!).state.definition).toBeNull();
    expect((await call('POST',`/${id}/messages`,'u1',{text:'João'})).json().completed).toBe(true);
  });
});

// Invariante de segurança: uma simulação nunca pode alcançar um remetente externo (WhatsApp, Meta/pixel, venda,
// notificação). Qualquer import novo aqui precisa ser decidido de propósito, editando esta lista.
describe('simulação não importa remetentes',()=>{
  const ALLOWED=new Set(['fastify','zod','node:crypto','@nexo/contracts','@nexo/domain','../../../core/audit.js','../../ai/runtime.js','../../webhooks/generic.js','../integration-test.js','./sessions.js']);
  it.each(['routes.ts','sessions.ts'])('%s só importa módulos da lista permitida',file=>{
    const src=readFileSync(new URL(`./${file}`,import.meta.url),'utf8');
    const specs=[...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(m=>m[1]!);
    expect(specs.filter(s=>!ALLOWED.has(s))).toEqual([]);
  });
});
