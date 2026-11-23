import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import argon2 from 'argon2';
import errors from '../../core/errors.js';
import authRateLimit from './rate-limit.js';
import {authRoutes} from './routes.js';
import {workspaceRoutes} from '../workspaces/routes.js';

// Redis em memória com o subconjunto usado (incl. o comando Lua do rate-limit).
function fakeRedis(){
  const data=new Map<string,{v:string;exp:number|null}>();
  const live=(k:string)=>{const e=data.get(k);if(e&&e.exp!==null&&e.exp<=Date.now()){data.delete(k);return undefined}return e};
  const r:any={
    defineCommand(name:string){r[name]=(key:string,tw:string,_max:string,_c:string,_e:string,cb:Function)=>{let e=live(key);const cur=(e?Number(e.v):0)+1;if(!e||false){e={v:'0',exp:Date.now()+Number(tw)};data.set(key,e)}e.v=String(cur);cb(null,[cur,Math.max(0,(e.exp??0)-Date.now())])}},
    async pttl(k:string){const e=live(k);return !e?-2:e.exp===null?-1:e.exp-Date.now()},
    async incr(k:string){const e=live(k);const n=(e?Number(e.v):0)+1;data.set(k,{v:String(n),exp:e?.exp??null});return n},
    async expire(k:string,s:number){const e=live(k);if(e)e.exp=Date.now()+s*1000;return 1},
    async set(k:string,v:string,_ex:string,s:number){data.set(k,{v,exp:Date.now()+s*1000});return 'OK'},
    async del(k:string){return data.delete(k)?1:0}
  };
  return r;
}

const ENV=['LOGIN_RATE_MAX','LOGIN_LOCKOUT_MAX_FAILS','LOGIN_LOCKOUT_SEC','REFRESH_RATE_MAX','INVITE_RATE_MAX'];
async function build(){
  const hash=await argon2.hash('senha-correta-123');
  const prisma:any={
    user:{findUnique:vi.fn(async({where}:any)=>where.email==='ana@x.com'?{id:'u1',name:'Ana',email:'ana@x.com',passwordHash:hash,isActive:true,memberships:[{workspaceId:'w1',role:'OWNER',workspace:{id:'w1',name:'W'}}]}:null),update:vi.fn()},
    session:{findUnique:vi.fn(async()=>null),create:vi.fn(),update:vi.fn()},
    workspaceInvite:{findUnique:vi.fn(async()=>null)},
    $transaction:vi.fn(async()=>[])
  };
  const app=Fastify();
  app.decorate('prisma',prisma);app.decorate('redis',fakeRedis());
  app.decorate('authenticate',async()=>{});app.decorate('requirePermission',(()=>async()=>{}) as any);
  await app.register(jwt,{secret:'test-secret-test-secret'});await app.register(errors);await app.register(authRateLimit);
  await app.register(authRoutes);await app.register(workspaceRoutes);await app.ready();
  return app;
}
const login=(app:any,email:string,password:string)=>app.inject({method:'POST',url:'/v1/auth/login',payload:{email,password}});

describe('rate limit e lockout de auth',()=>{
  beforeEach(()=>{process.env.LOGIN_RATE_MAX='100';process.env.LOGIN_LOCKOUT_MAX_FAILS='3';process.env.LOGIN_LOCKOUT_SEC='60';vi.useFakeTimers({toFake:['Date']})});
  afterEach(()=>{vi.useRealTimers();for(const k of ENV)delete process.env[k]});

  it('N falhas => 429 com retry-after; correto durante lockout é bloqueado; volta após a janela',async()=>{
    const app=await build();
    for(let i=0;i<3;i++){const r=await login(app,'ana@x.com','errada-errada');expect(r.statusCode).toBe(401)}
    const blocked=await login(app,'ana@x.com','errada-errada');
    expect(blocked.statusCode).toBe(429);expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);expect(blocked.json().code).toBe('RATE_LIMITED');
    expect((await login(app,'ana@x.com','senha-correta-123')).statusCode).toBe(429);
    vi.setSystemTime(Date.now()+61_000);
    const ok=await login(app,'ana@x.com','senha-correta-123');expect(ok.statusCode).toBe(200);expect(ok.json().accessToken).toBeTruthy();
    await app.close();
  });
  it('e-mail inexistente recebe o mesmo tratamento (não revela existência)',async()=>{
    const app=await build();const codes:number[]=[];
    for(let i=0;i<4;i++)codes.push((await login(app,'nao@existe.com','qualquer-senha')).statusCode);
    expect(codes).toEqual([401,401,401,429]);await app.close();
  });
  it('limite por IP no login',async()=>{
    process.env.LOGIN_RATE_MAX='2';process.env.LOGIN_LOCKOUT_MAX_FAILS='50';const app=await build();
    const c:number[]=[];for(let i=0;i<3;i++)c.push((await login(app,`u${i}@x.com`,'x-x-x-x-x-x')).statusCode);
    expect(c).toEqual([401,401,429]);await app.close();
  });
  it('refresh limitado por IP',async()=>{
    process.env.REFRESH_RATE_MAX='2';const app=await build();const c:number[]=[];let last:any;
    for(let i=0;i<3;i++){last=await app.inject({method:'POST',url:'/v1/auth/refresh',payload:{refreshToken:'t'.repeat(40)}});c.push(last.statusCode)}
    expect(c).toEqual([401,401,429]);expect(last.headers['retry-after']).toBeDefined();expect(last.json().code).toBe('RATE_LIMITED');await app.close();
  });
  it('aceite de convite limitado por IP',async()=>{
    process.env.INVITE_RATE_MAX='2';const app=await build();const c:number[]=[];let last:any;
    for(let i=0;i<3;i++){last=await app.inject({method:'POST',url:'/v1/invitations/accept',payload:{token:'k'.repeat(40),name:'Bob',password:'senha-longa-123'}});c.push(last.statusCode)}
    expect(c).toEqual([404,404,429]);expect(last.headers['retry-after']).toBeDefined();await app.close();
  });
});
