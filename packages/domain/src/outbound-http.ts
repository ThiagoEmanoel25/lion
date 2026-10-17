import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';

export function isPrivateAddress(address:string):boolean{
  const normalized=address.toLowerCase().split('%')[0]!;
  if(normalized==='::1'||normalized==='::'||normalized.startsWith('fc')||normalized.startsWith('fd')||normalized.startsWith('fe8')||normalized.startsWith('fe9')||normalized.startsWith('fea')||normalized.startsWith('feb'))return true;
  const mapped=normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const value=mapped??normalized;
  if(isIP(value)!==4)return false;
  const parts=value.split('.').map(Number);const [a,b]=parts;
  return a===0||a===10||a===127||a===169&&b===254||a===172&&b!>=16&&b!<=31||a===192&&b===168||a===100&&b!>=64&&b!<=127||a!>=224;
}

export type AddressResolver=(hostname:string)=>Promise<Array<{address:string;family:number}>>;
const defaultResolver:AddressResolver=hostname=>lookup(hostname,{all:true});
export async function assertPublicHttpsUrl(raw:string,resolver:AddressResolver=defaultResolver):Promise<URL>{
  let url:URL;try{url=new URL(raw)}catch{throw new Error('Informe uma URL válida.')}
  if(url.protocol!=='https:')throw new Error('A integração aceita somente URLs HTTPS.');
  if(url.username||url.password)throw new Error('A URL não pode conter usuário ou senha.');
  const hostname=url.hostname.toLowerCase();
  if(hostname==='localhost'||hostname.endsWith('.localhost')||hostname.endsWith('.local')||hostname.endsWith('.internal'))throw new Error('A integração não pode acessar endereços internos.');
  if(isIP(hostname)){if(isPrivateAddress(hostname))throw new Error('A integração não pode acessar endereços internos.');return url}
  let addresses:Array<{address:string;family:number}>;
  try{addresses=await resolver(hostname)}catch{throw new Error('Não foi possível resolver o endereço da integração.')}
  if(!addresses.length||addresses.some(item=>isPrivateAddress(item.address)))throw new Error('A integração não pode acessar endereços internos.');
  return url;
}
