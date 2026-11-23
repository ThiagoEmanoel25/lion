import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import argon2 from 'argon2';
import {PrismaClient} from '@prisma/client';
import errors from '../../core/errors.js';
import authRateLimit from './rate-limit.js';
import {authRoutes} from './routes.js';

// Roda contra Postgres real se T17_DATABASE_URL existir; senão usa um fake em memória.
const REAL=process.env.T17_DATABASE_URL;
const tag=Math.random().toString(36).slice(2,8);
const EMAIL=`ana-${tag}@x.com`,PASS='senha-correta-123';
type S={id:string;userId:string;tokenHash:string;expiresAt:Date;revokedAt:Date|null;familyId?:string|null;workspaceId?:string|null};

function fakeRedis(){const r:any={defineCommand(n:string){r[n]=(_k:string,_t:string,_m:string,_c:string,_e:string,cb:Function)=>cb(null,[1,1000])},pttl:async()=>-2,incr:async()=>1,expire:async()=>1,set:async()=>'OK',del:async()=>0};return r}

async function fakePrisma(hash:string){
  const sessions:S[]=[];const audits:any[]=[];let n=0;
  const t0=Date.now();
  // wB criado ANTES de wA na inserção, mas wA é mais antigo por createdAt.
  const memberships=[{id:'mB',workspaceId:'wB',role:'ADMIN',isActive:true,createdAt:new Date(t0),workspace:{id:'wB',name:'B'}},{id:'mA',workspaceId:'wA',role:'OWNER',isActive:true,createdAt:new Date(t0-5000),workspace:{id:'wA',name:'A'}}];
  const match=(s:S,w:any):boolean=>Object.entries(w).every(([k,v]:any)=>k==='OR'?v.some((x:any)=>match(s,x)):k==='revokedAt'&&v===null?s.revokedAt===null:(s as any)[k]===v);
  const p:any={
    user:{findUnique:async({where}:any)=>where.email===EMAIL?{id:'u1',name:'Ana',email:EMAIL,passwordHash:hash,isActive:true,memberships}:null,update:async()=>({})},
    session:{
      create:async({data}:any)=>{const s={id:`s${++n}`,revokedAt:null,...data};sessions.push(s);return s},
      findUnique:async({where}:any)=>{const s=sessions.find(x=>x.tokenHash===where.tokenHash);return s?{...s,user:{id:'u1',name:'Ana',email:EMAIL,isActive:true,memberships}}:null},
      updateMany:async({where,data}:any)=>{const hit=sessions.filter(s=>match(s,where));hit.forEach(s=>Object.assign(s,data));return {count:hit.length}}
    },
    auditLog:{create:async({data}:any)=>{audits.push(data);return data}},
    $transaction:async(ops:Promise<any>[])=>Promise.all(ops),
    _sessions:sessions,_audits:audits
  };
  return p;
}

let prisma:any,hash:string;
async function build(){
  const app=Fastify();app.decorate('prisma',prisma);app.decorate('redis',fakeRedis());
  app.decorate('authenticate',async(req:any)=>{const p=await req.jwtVerify();req.auth=p});
  await app.register(jwt,{secret:'test-secret-test-secret'});await app.register(errors);await app.register(authRateLimit);await app.register(authRoutes);await app.ready();return app;
}
const login=(app:any,extra:any={})=>app.inject({method:'POST',url:'/v1/auth/login',payload:{email:EMAIL,password:PASS,...extra}});
const refresh=(app:any,t:string)=>app.inject({method:'POST',url:'/v1/auth/refresh',payload:{refreshToken:t}});
const sessionsOf=async()=>REAL?prisma.session.findMany({where:{user:{email:EMAIL}}}):prisma._sessions;
const audits=async()=>REAL?prisma.auditLog.findMany({where:{action:'auth.refresh_reuse_detected'}}):prisma._audits;

beforeAll(async()=>{
  hash=await argon2.hash(PASS);
  if(!REAL){prisma=await fakePrisma(hash);return}
  prisma=new PrismaClient({datasources:{db:{url:REAL}}});
  const u=await prisma.user.create({data:{email:EMAIL,name:'Ana',passwordHash:hash}});
  const wA=await prisma.workspace.create({data:{name:'A',slug:`a-${tag}`}});const wB=await prisma.workspace.create({data:{name:'B',slug:`b-${tag}`}});
  // B inserido primeiro, mas A tem createdAt mais antigo.
  await prisma.membership.create({data:{workspaceId:wB.id,userId:u.id,role:'ADMIN',createdAt:new Date()}});
  await prisma.membership.create({data:{workspaceId:wA.id,userId:u.id,role:'OWNER',createdAt:new Date(Date.now()-5000)}});
  (globalThis as any).__ws={a:wA.id,b:wB.id};
});
afterAll(async()=>{if(REAL){await prisma.$disconnect()}});
const ws=()=>REAL?(globalThis as any).__ws:{a:'wA',b:'wB'};

describe('endurecimento de auth (task 17)',()=>{
  it('sem workspaceId entra sempre na membership ativa mais antiga; com workspaceId entra na escolhida',async()=>{
    const app=await build();
    for(let i=0;i<3;i++){const r=await login(app);expect(r.statusCode).toBe(200);expect(r.json().workspace.id).toBe(ws().a)}
    const b=await login(app,{workspaceId:ws().b});expect(b.statusCode).toBe(200);expect(b.json().workspace.id).toBe(ws().b);
    // refresh preserva o workspace escolhido
    const rf=await refresh(app,b.json().refreshToken);expect(rf.statusCode).toBe(200);expect(rf.json().workspace.id).toBe(ws().b);
    await app.close();
  });
  it('workspaceId alheio dá o mesmo 401 genérico da senha errada',async()=>{
    const app=await build();
    const wrong=await app.inject({method:'POST',url:'/v1/auth/login',payload:{email:EMAIL,password:'errada-errada-1'}});
    const alien=await login(app,{workspaceId:'ws-alheio'});
    expect(alien.statusCode).toBe(401);expect(alien.statusCode).toBe(wrong.statusCode);
    expect({...alien.json(),requestId:0}).toEqual({...wrong.json(),requestId:0});await app.close();
  });
  it('reuso de refresh revogado revoga a cadeia, o refresh novo falha (401) e grava auditoria',async()=>{
    const app=await build();
    const l=await login(app);const t1=l.json().refreshToken;
    const r2=await refresh(app,t1);expect(r2.statusCode).toBe(200);const t2=r2.json().refreshToken;
    const r3=await refresh(app,t2);expect(r3.statusCode).toBe(200);const t3=r3.json().refreshToken;
    const other=await login(app);const otherT=other.json().refreshToken; // outro login: outra cadeia
    const reuse=await refresh(app,t1);expect(reuse.statusCode).toBe(401);
    expect((await refresh(app,t3)).statusCode).toBe(401); // token "novo" também morreu
    expect((await refresh(app,t2)).statusCode).toBe(401);
    const all=await sessionsOf();const fam=await_family(all,t1);const chain=all.filter((s:any)=>(s.familyId??s.id)===fam);
    expect(chain.length).toBe(3);expect(chain.every((s:any)=>s.revokedAt)).toBe(true);
    expect((await refresh(app,otherT)).statusCode).toBe(200); // outra cadeia intacta
    const a=await audits();expect(a.length).toBeGreaterThanOrEqual(1);expect(a[0].action).toBe('auth.refresh_reuse_detected');expect(JSON.stringify(a[0])).not.toContain(t1);
    await app.close();
  });
  it('logout simples revoga só o refresh enviado; logout all revoga todas as sessões',async()=>{
    const app=await build();
    const l1=(await login(app)).json(),l2=(await login(app)).json();
    const h={authorization:`Bearer ${l1.accessToken}`};
    expect((await app.inject({method:'POST',url:'/v1/auth/logout',headers:h,payload:{refreshToken:l1.refreshToken}})).statusCode).toBe(204);
    expect((await refresh(app,l1.refreshToken)).statusCode).toBe(401);
    const ok=await refresh(app,l2.refreshToken);expect(ok.statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:'/v1/auth/logout',headers:h,payload:{all:true}})).statusCode).toBe(204);
    expect((await refresh(app,ok.json().refreshToken)).statusCode).toBe(401);
    const live=(await sessionsOf()).filter((s:any)=>!s.revokedAt&&new Date(s.expiresAt)>new Date());
    expect(live.length).toBe(0);await app.close();
  });
});
import {createHash} from 'node:crypto';
function await_family(all:any[],token:string){const h=createHash('sha256').update(token).digest('hex');const s=all.find(x=>x.tokenHash===h);return s.familyId??s.id}
