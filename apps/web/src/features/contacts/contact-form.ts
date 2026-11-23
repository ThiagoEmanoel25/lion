import type {ContactConsentState} from './types';

export type ContactFormState={name:string;phone:string;email:string;source:string;stage:string;ownerId:string;tagIds:string[];customFields:CustomFieldPair[];consentGiven:boolean;consentSource:string;reconsent:boolean};
export type CustomFieldPair={key:string;value:string;original?:unknown};
export type ContactPayload={name?:string|null;phone?:string;email?:string|null;source?:string|null;stage?:string;ownerId?:string|null;tagIds?:string[];customFields?:Record<string,unknown>;consent?:{given:boolean;source:string;reconsent?:boolean}};
export type InitialContact={name:string|null;phone:string;email:string|null;source:string|null;stage:string;owner?:{id:string}|null;tags:Array<{tag:{id:string}}>;customFields?:Record<string,unknown>;consent?:ContactConsentState};

export const consentSources:Array<[string,string]>=[['manual','Manual (cadastro pela equipe)'],['formulario','Formulário'],['whatsapp','Pedido pelo WhatsApp'],['presencial','Presencial'],['evento','Evento'],['csv','Importação CSV']];

const displayValue=(value:unknown)=>typeof value==='string'?value:value!==null&&typeof value==='object'?JSON.stringify(value):String(value??'');
export function customFieldsToPairs(fields:Record<string,unknown>|null|undefined):CustomFieldPair[]{return Object.entries(fields??{}).map(([key,value])=>({key,value:displayValue(value),original:value}))}
/** Mantém o tipo original (número, objeto…) quando o texto não foi editado; chaves vazias são ignoradas e a última repetida vence. */
export function pairsToCustomFields(pairs:CustomFieldPair[]):Record<string,unknown>{const result:Record<string,unknown>={};for(const pair of pairs){const key=pair.key.trim();if(!key)continue;result[key]=pair.original!==undefined&&displayValue(pair.original)===pair.value?pair.original:pair.value}return result}
export function duplicatedKeys(pairs:CustomFieldPair[]){const seen=new Set<string>();const dup=new Set<string>();for(const pair of pairs){const key=pair.key.trim();if(!key)continue;if(seen.has(key))dup.add(key);seen.add(key)}return [...dup]}

export function formFromContact(contact:InitialContact|null):ContactFormState{
  if(!contact)return {name:'',phone:'',email:'',source:'',stage:'new',ownerId:'',tagIds:[],customFields:[],consentGiven:false,consentSource:'manual',reconsent:false};
  return {name:contact.name??'',phone:contact.phone,email:contact.email??'',source:contact.source??'',stage:contact.stage,ownerId:contact.owner?.id??'',tagIds:contact.tags.map(item=>item.tag.id),customFields:customFieldsToPairs(contact.customFields),consentGiven:Boolean(contact.consent?.given)&&!contact.consent?.optedOut,consentSource:contact.consent?.source||'manual',reconsent:false};
}

/**
 * Monta o corpo do POST/PATCH. Criação: campos vazios são omitidos (nunca null).
 * Edição: campo que tinha valor e foi esvaziado vai como null (única forma de limpar); o que já estava vazio é omitido.
 */
export function buildContactPayload(form:ContactFormState,initial:InitialContact|null):ContactPayload{
  const payload:ContactPayload={phone:form.phone.trim(),stage:form.stage,tagIds:form.tagIds,customFields:pairsToCustomFields(form.customFields)};
  const optional=(key:'name'|'email'|'source',value:string)=>{const text=value.trim();if(text){payload[key]=text}else if(initial&&initial[key])payload[key]=null};
  optional('name',form.name);optional('email',form.email);optional('source',form.source);
  if(form.ownerId)payload.ownerId=form.ownerId;else if(initial?.owner)payload.ownerId=null;
  const consent=consentChange(form,initial?.consent);if(consent)payload.consent=consent;
  return payload;
}
/** Só envia consentimento quando o estado muda; opt-out só é revertido com a confirmação explícita (reconsent). */
export function consentChange(form:Pick<ContactFormState,'consentGiven'|'consentSource'|'reconsent'>,current?:ContactConsentState){
  if(current?.optedOut)return form.reconsent?{given:true,source:form.consentSource||'manual',reconsent:true}:undefined;
  const was=Boolean(current?.given);if(form.consentGiven===was)return undefined;
  return {given:form.consentGiven,source:form.consentSource||'manual'};
}

const fieldLabels:Record<string,string>={name:'Nome',phone:'Telefone',email:'E-mail',source:'Origem',stage:'Etapa',ownerId:'Responsável',tagIds:'Etiquetas',customFields:'Campos personalizados',consent:'Consentimento'};
export const fieldLabel=(field:string)=>fieldLabels[field]??field;
/** Traduz mensagens do zod (inglês) para pt-BR; mensagens já em pt-BR passam direto. */
export function translateFieldMessage(field:string,message:string){
  const min=/>=\s*(\d+)\s+characters/i.exec(message);if(min)return field==='phone'?`Informe um telefone com pelo menos ${min[1]} caracteres (DDI e DDD).`:`Use pelo menos ${min[1]} caracteres.`;
  const max=/<=\s*(\d+)\s+characters/i.exec(message);if(max)return `Use no máximo ${max[1]} caracteres.`;
  if(/invalid email/i.test(message))return 'Informe um e-mail válido, como nome@empresa.com.';
  if(/invalid input|invalid (string|type)|expected (string|object|array|boolean)/i.test(message))return 'Valor inválido.';
  if(/required/i.test(message))return 'Campo obrigatório.';
  if(/^[A-Za-z .,'"<>=\d-]+$/.test(message)&&/expected|too (small|big)|invalid/i.test(message))return 'Valor inválido.';
  return message;
}
/** Extrai details.fieldErrors da resposta de validação (422) da API. */
export function fieldErrorsFrom(details:unknown):Record<string,string>{
  const result:Record<string,string>={};if(!details||typeof details!=='object')return result;
  const raw=(details as {fieldErrors?:Record<string,unknown>}).fieldErrors;if(!raw||typeof raw!=='object')return result;
  for(const [field,messages] of Object.entries(raw)){const first=Array.isArray(messages)?messages.find(item=>typeof item==='string'):undefined;if(first)result[field.split('.')[0]!]=translateFieldMessage(field,first)}
  return result;
}
/** Validação local, antes de chamar a API (substitui a validação nativa do navegador, que vem em inglês). */
export function validateContactForm(form:ContactFormState):Record<string,string>{
  const errors:Record<string,string>={};const phone=form.phone.trim();
  if(!phone)errors.phone='Informe o telefone do contato.';else if(phone.replace(/\D/g,'').length<8)errors.phone='Informe um telefone com DDI e DDD, por exemplo +55 71 99999-9999.';
  if(form.email.trim()&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))errors.email='Informe um e-mail válido, como nome@empresa.com.';
  const dup=duplicatedKeys(form.customFields);if(dup.length)errors.customFields=`Chave repetida nos campos personalizados: ${dup.join(', ')}.`;
  return errors;
}

export type ImportError={row:number;message:string};
export type ImportReportView={total:number;created:number;updated:number;failed:number;consentRecorded:number;consentSkippedOptedOut:number;errors:ImportError[]};
export function normalizeImportReport(body:unknown):ImportReportView|null{
  if(!body||typeof body!=='object')return null;const data=body as Record<string,unknown>;if(!Array.isArray(data.errors)&&typeof data.created!=='number')return null;
  const num=(value:unknown)=>typeof value==='number'?value:0;
  const errors=(Array.isArray(data.errors)?data.errors:[]).filter((item):item is {row:unknown;message:unknown}=>Boolean(item)&&typeof item==='object').map(item=>({row:Number(item.row)||0,message:String(item.message??'Erro desconhecido.')}));
  return {total:num(data.total),created:num(data.created),updated:num(data.updated),failed:num(data.failed)||errors.length,consentRecorded:num(data.consentRecorded),consentSkippedOptedOut:num(data.consentSkippedOptedOut),errors};
}
export const importErrorLine=(error:ImportError)=>error.row<=1&&/cabeçalho|cabecalho|precisa ter/i.test(error.message)?`Cabeçalho (linha 1): ${error.message}`:`Linha ${error.row}: ${error.message}`;
export function importSummary(report:ImportReportView){const parts=[`${report.created} criado${report.created===1?'':'s'}`,`${report.updated} atualizado${report.updated===1?'':'s'}`,`${report.failed} com erro`];return parts.join(' · ')}
