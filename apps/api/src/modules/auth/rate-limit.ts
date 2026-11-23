import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import {createHash} from 'node:crypto';
import type {FastifyInstance,FastifyReply,FastifyRequest} from 'fastify';
import {DomainError} from '@nexo/domain';

const num=(name:string,fallback:number)=>{const v=Number(process.env[name]);return Number.isFinite(v)&&v>0?Math.floor(v):fallback};
/** Limites lidos do ambiente (defaults seguros). Janelas em segundos. */
export const authLimits=()=>({
  loginMax:num('LOGIN_RATE_MAX',20),loginWindowSec:num('LOGIN_RATE_WINDOW_SEC',60),
  lockMaxFails:num('LOGIN_LOCKOUT_MAX_FAILS',5),lockWindowSec:num('LOGIN_LOCKOUT_WINDOW_SEC',900),lockSec:num('LOGIN_LOCKOUT_SEC',900),
  refreshMax:num('REFRESH_RATE_MAX',30),refreshWindowSec:num('REFRESH_RATE_WINDOW_SEC',60),
  inviteMax:num('INVITE_RATE_MAX',10),inviteWindowSec:num('INVITE_RATE_WINDOW_SEC',60),
  resetMax:num('RESET_RATE_MAX',10),resetWindowSec:num('RESET_RATE_WINDOW_SEC',60),resetTokenMax:num('RESET_TOKEN_MAX_ATTEMPTS',5),resetTokenWindowSec:num('RESET_TOKEN_WINDOW_SEC',900)
});
const rateRoute=(max:number,windowSec:number)=>({rateLimit:{max,timeWindow:windowSec*1000}});
export const loginRateConfig=()=>{const l=authLimits();return rateRoute(l.loginMax,l.loginWindowSec)};
export const refreshRateConfig=()=>{const l=authLimits();return rateRoute(l.refreshMax,l.refreshWindowSec)};
export const resetRateConfig=()=>{const l=authLimits();return rateRoute(l.resetMax,l.resetWindowSec)};
export const inviteRateConfig=()=>{const l=authLimits();return rateRoute(l.inviteMax,l.inviteWindowSec)};

const tooMany=(retryAfterSec:number)=>new DomainError('RATE_LIMITED','Muitas tentativas. Aguarde e tente novamente.',429,{retryAfterSec});

/** Plugin: registra @fastify/rate-limit (global:false) usando app.redis; só rotas com config.rateLimit são limitadas, por IP. */
export default fp(async(app:FastifyInstance)=>{
  await app.register(rateLimit,{
    global:false,redis:app.redis,nameSpace:'nexo:rl:',
    errorResponseBuilder:(request,context)=>{const retryAfterSec=Math.max(1,Math.ceil(context.ttl/1000));request.log.warn({ip:request.ip,url:request.url,retryAfterSec},'rate limit excedido');return tooMany(retryAfterSec)}
  });
});

const hashEmail=(email:string)=>createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
const emailKey=(request:FastifyRequest)=>{const email=(request.body as {email?:unknown}|null)?.email;return typeof email==='string'&&email.trim()?hashEmail(email):null};

/** preHandler do login: recusa com 429 se o e-mail está em lockout (igual para e-mails existentes ou não). */
export async function loginLockGuard(this:FastifyInstance,request:FastifyRequest,reply:FastifyReply){
  const key=emailKey(request);if(!key)return;
  const ttl=await this.redis.pttl(`nexo:lock:login:${key}`);
  if(ttl>0){const retryAfterSec=Math.max(1,Math.ceil(ttl/1000));request.log.warn({ip:request.ip,emailHash:key.slice(0,12),retryAfterSec},'login bloqueado por lockout');reply.header('retry-after',retryAfterSec);throw tooMany(retryAfterSec)}
}
export async function recordLoginFailure(app:FastifyInstance,request:FastifyRequest,email?:string){
  const key=email?hashEmail(email):emailKey(request);if(!key)return;const l=authLimits();const fails=`nexo:fail:login:${key}`;
  const n=await app.redis.incr(fails);if(n===1)await app.redis.expire(fails,l.lockWindowSec);
  if(n>=l.lockMaxFails){await app.redis.set(`nexo:lock:login:${key}`,'1','EX',l.lockSec);await app.redis.del(fails);request.log.warn({ip:request.ip,emailHash:key.slice(0,12),lockSec:l.lockSec},'lockout de login aplicado')}
}
export async function clearLoginFailures(app:FastifyInstance,request:FastifyRequest,email?:string){const key=email?hashEmail(email):emailKey(request);if(key)await app.redis.del(`nexo:fail:login:${key}`)}
/** Lockout por e-mail fora do corpo do login (change-password autenticado): 429 se o e-mail está bloqueado. */
export async function assertLoginNotLocked(app:FastifyInstance,request:FastifyRequest,reply:FastifyReply,email:string){
  const ttl=await app.redis.pttl(`nexo:lock:login:${hashEmail(email)}`);
  if(ttl>0){const retryAfterSec=Math.max(1,Math.ceil(ttl/1000));reply.header('retry-after',retryAfterSec);throw tooMany(retryAfterSec)}
}
/** Remove falha e lockout do e-mail (após redefinição de senha concluída). */
export async function clearLoginLock(app:FastifyInstance,email:string){const key=hashEmail(email);await app.redis.del(`nexo:fail:login:${key}`,`nexo:lock:login:${key}`)}
/** preHandler da confirmação de reset: limita tentativas por token (hash) além do limite por IP da rota. */
export async function resetTokenGuard(this:FastifyInstance,request:FastifyRequest){
  const token=(request.body as {token?:unknown}|null)?.token;if(typeof token!=='string'||!token)return;
  const l=authLimits();const key=`nexo:rl:reset-token:${createHash('sha256').update(token).digest('hex')}`;
  const n=await this.redis.incr(key);if(n===1)await this.redis.expire(key,l.resetTokenWindowSec);
  if(n>l.resetTokenMax){const ttl=await this.redis.pttl(key);throw tooMany(Math.max(1,Math.ceil(ttl/1000)))}
}
