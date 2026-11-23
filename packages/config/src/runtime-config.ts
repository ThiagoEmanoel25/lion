// Validação fail-closed da configuração de runtime. Sem dependências (usada pela API e pelo runtime).
type Env=Record<string,string|undefined>;
export class RuntimeConfigError extends Error{constructor(public readonly problems:string[]){super(`Configuração inválida para produção:\n${problems.map(p=>` - ${p}`).join('\n')}`);this.name='RuntimeConfigError'}}
const PLACEHOLDERS=new Set(['replace-with-at-least-32-characters','replace-with-32-byte-base64-key','changeme','change-me']);
const isPlaceholder=(v:string)=>PLACEHOLDERS.has(v.trim().toLowerCase())||/^replace-with/i.test(v.trim());
function httpsUrls(value:string):boolean{
  const parts=value.split(',').map(s=>s.trim());
  if(parts.length===0||parts.some(p=>!p))return false;
  return parts.every(p=>{try{return new URL(p).protocol==='https:'}catch{return false}});
}
/** Lista de problemas (nunca contém valores de segredos). Só válida para produção. */
export function runtimeConfigProblems(env:Env):string[]{
  const problems:string[]=[];
  const need=(k:string)=>{const v=env[k];if(!v||!v.trim()){problems.push(`${k}: ausente`);return undefined}return v};
  need('DATABASE_URL');need('REDIS_URL');
  const jwt=need('JWT_SECRET');
  if(jwt!==undefined){if(isPlaceholder(jwt))problems.push('JWT_SECRET: ainda é o placeholder dos arquivos .env*.example');else if(jwt.length<32)problems.push('JWT_SECRET: precisa ter pelo menos 32 caracteres')}
  const key=need('FIELD_ENCRYPTION_KEY');
  if(key!==undefined){
    if(isPlaceholder(key))problems.push('FIELD_ENCRYPTION_KEY: ainda é o placeholder dos arquivos .env*.example');
    else{const t=key.trim();const bytes=/^[A-Za-z0-9+/]+={0,2}$/.test(t)&&t.length%4===0?Buffer.from(t,'base64').length:-1;if(bytes!==32)problems.push('FIELD_ENCRYPTION_KEY: deve ser base64 que decodifica para exatamente 32 bytes (openssl rand -base64 32)')}
  }
  for(const k of ['WEB_ORIGIN','PUBLIC_API_URL']){const v=need(k);if(v!==undefined&&!httpsUrls(v))problems.push(`${k}: precisa ser uma URL https válida${k==='WEB_ORIGIN'?' (lista separada por vírgula permitida)':''}`)}
  return problems;
}
type Log={warn:(m:string)=>void};
/** Produção: lança RuntimeConfigError listando TODAS as variáveis erradas. Fora dela: só avisa. */
export function assertRuntimeConfig(env:Env=process.env,log:Log={warn:m=>console.warn(m)}):void{
  const problems=runtimeConfigProblems(env);
  if(env.NODE_ENV==='production'){if(problems.length)throw new RuntimeConfigError(problems);return}
  if(problems.length)log.warn(`[config] NODE_ENV!=production: usando defaults de desenvolvimento; em produção estes itens falhariam:\n${problems.map(p=>` - ${p}`).join('\n')}`);
}
/** Para entrypoints: imprime e sai com código 1 se inválido. */
export function assertRuntimeConfigOrExit(env:Env=process.env):void{
  try{assertRuntimeConfig(env)}catch(e){console.error(JSON.stringify({level:'fatal',msg:'invalid_runtime_config'}));console.error((e as Error).message);process.exit(1)}
}
/**
 * Origem(ns) CORS. Produção: WEB_ORIGIN obrigatório, sem fallback. Dev/test: fallback localhost.
 * Aceita lista separada por vírgula. A origem fixa https://app.leonasolutions.io da rota
 * /v1/imports/leona/:code é intencional e vale só naquela rota (config.cors por rota).
 */
export function resolveCorsOrigin(env:Env=process.env):string|string[]{
  const raw=env.WEB_ORIGIN?.trim();
  if(!raw){if(env.NODE_ENV==='production')throw new RuntimeConfigError(['WEB_ORIGIN: ausente (obrigatório em produção para CORS)']);return 'http://localhost:5173'}
  const list=raw.split(',').map(s=>s.trim()).filter(Boolean);
  return list.length===1?list[0]!:list;
}
