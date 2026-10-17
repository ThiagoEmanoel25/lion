import {assertPublicHttpsUrl,DomainError} from '@nexo/domain';
import {renderUrlTemplate} from '@nexo/contracts';

const MAX_RESPONSE_BYTES=100_000;
const BLOCKED_HEADERS=new Set(['connection','content-length','host','proxy-authorization','transfer-encoding','upgrade']);

const render=(template:string,variables:Record<string,unknown>)=>template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g,(_match,path:string)=>{
  let value:unknown=variables;for(const part of path.split('.'))value=value&&typeof value==='object'&&!Array.isArray(value)?(value as Record<string,unknown>)[part]:undefined;
  return value===undefined||value===null?'':typeof value==='object'?JSON.stringify(value):String(value);
});

async function limitedText(response:Response){
  if(!response.body)return '';
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_RESPONSE_BYTES){await reader.cancel().catch(()=>undefined);throw new Error('A resposta ultrapassou 100 KB.')}chunks.push(value)}}finally{reader.releaseLock()}
  const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength}return new TextDecoder().decode(data);
}

export class IntegrationUrlBlockedError extends Error{}
export const RATE_SCRIPT="local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n";
// 10 tests per minute per user; same Redis counter pattern as the inbound webhook rateLimit.
export async function integrationTestRateLimit(redis:{eval:(...args:any[])=>Promise<unknown>},userId:string){
  if(Number(await redis.eval(RATE_SCRIPT,1,`rate:integration-test:${userId}:${Math.floor(Date.now()/60_000)}`,70))>10)throw new DomainError('RATE_LIMITED','Limite de 10 testes por minuto excedido.',429);
}

export type IntegrationTestResult={ok:boolean;status:number;durationMs:number;headers:Record<string,string>;body:unknown};
export async function testIntegrationRequest(input:{config:{url:string;method:string;headers:Record<string,string>;body?:string};variables:Record<string,unknown>;fetchImpl?:typeof fetch}):Promise<IntegrationTestResult>{
  let url:URL;try{url=await assertPublicHttpsUrl(renderUrlTemplate(input.config.url,input.variables))}catch(error){throw new IntegrationUrlBlockedError(error instanceof Error?error.message:'A URL da integração não é permitida.')}
  const headers=Object.fromEntries(Object.entries(input.config.headers).filter(([key])=>!BLOCKED_HEADERS.has(key.toLowerCase())).map(([key,value])=>[key,render(value,input.variables)]));
  const method=input.config.method.toUpperCase();const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30_000);const started=Date.now();
  try{
    const response=await (input.fetchImpl??fetch)(url,{method,headers,...(!['GET','HEAD'].includes(method)&&input.config.body!==undefined?{body:render(input.config.body,input.variables)}:{}),redirect:'manual',signal:controller.signal});
    const raw=await limitedText(response);let body:unknown=raw;try{body=raw?JSON.parse(raw):null}catch{/* texto é um resultado válido */}
    return {ok:response.ok,status:response.status,durationMs:Date.now()-started,headers:Object.fromEntries(response.headers.entries()),body};
  }catch(error){if(error instanceof Error&&error.name==='AbortError')throw new Error('A integração não respondeu em 30 segundos.');throw error}finally{clearTimeout(timeout)}
}
