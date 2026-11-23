import {ApiError} from '../../shared/api/client';

const FIELD_LABELS:Record<string,string>={name:'Nome',definition:'Definição do fluxo',expectedVersion:'Versão',folderId:'Pasta',code:'Código',description:'Descrição'};
/** Mensagem em pt-BR para erros da API; usa `details.fieldErrors` quando houver. */
export function flowErrorMessage(error:unknown,fallback='Não foi possível concluir a ação. Tente novamente.'):string{
  if(!(error instanceof ApiError))return fallback;
  const details=error.details as {fieldErrors?:Record<string,string[]|undefined>;formErrors?:string[]}|undefined;
  const lines:string[]=[];
  for(const [field,messages] of Object.entries(details?.fieldErrors??{})){const text=(messages??[]).filter(Boolean).join(', ');if(text)lines.push(`${FIELD_LABELS[field]??field}: ${text}`)}
  for(const message of details?.formErrors??[])if(message)lines.push(message);
  if(!lines.length)return error.message||fallback;
  return `${error.message||fallback} ${lines.slice(0,3).join('; ')}`;
}
/** Salvar sem mudanças: a API devolve 409 e a versão atual; para quem publica isso significa "nada a salvar". */
export function unchangedVersion(error:unknown):{current:number|null}|null{
  if(!(error instanceof ApiError)||error.code!=='UNCHANGED_DEFINITION')return null;
  const current=(error.details as {currentVersion?:unknown}|undefined)?.currentVersion;
  return {current:typeof current==='number'?current:null};
}
