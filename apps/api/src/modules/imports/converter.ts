import {AutomationDefinitionSchema,AutomationDelayConfigSchema,PIXEL_EVENTS,type ImportReportSchema} from '@nexo/contracts';
import type {z} from 'zod';

type JsonObject=Record<string,unknown>;
type Definition=z.infer<typeof AutomationDefinitionSchema>;
export type ImportReport=z.infer<typeof ImportReportSchema>;
export type ConversionResult={definition:Definition;report:ImportReport;suggestedName:string};

const knownVariables:Record<string,string>={phone_number:'contact.phone',first_name:'contact.firstName',last_message:'last_message',instance_number:'channel.phone','ai.fail.reason':'ai.fail.reason','resposta.gpt':'resposta.gpt'};
const sensitiveKey=/(authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|token|secret|password)/i;
const object=(value:unknown):JsonObject=>value&&typeof value==='object'&&!Array.isArray(value)?value as JsonObject:{};
const text=(...values:unknown[])=>values.find(value=>typeof value==='string'&&value.trim()) as string|undefined;
const num=(value:unknown,fallback=0)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
const sourceId=(node:JsonObject,index:number)=>text(node.id,object(node.data).id)??String(index+1);
const nodeType=(node:JsonObject)=>String(text(node.type,object(node.data).type,object(node.data).blockType,object(node.data).block_type,object(node.data).kind)??'unknown').toLowerCase();
const configOf=(node:JsonObject)=>{const data=object(node.data);return Object.keys(object(data.config)).length?object(data.config):data};
const cleanId=(prefix:string,id:string)=>`${prefix}_${id.replace(/[^A-Za-z0-9_-]/g,'_')}`.slice(0,80);
export const importedNodeId=(sourceId:string)=>cleanId('leona',sourceId);

function report(source:'leona'|'nexo',items:ImportReport['items']):ImportReport {
  return {source,items,totals:{converted:items.filter(item=>item.status==='converted').length,adjusted:items.filter(item=>item.status==='adjusted').length,pending:items.filter(item=>item.status==='pending').length}};
}

function replaceVariables(value:string,items:ImportReport['items'],id:string){
  return value.replace(/\{([A-Za-z_][\w.-]*)\}/g,(_,name:string)=>{
    const mapped=knownVariables[name];
    if(mapped)return `{{${mapped}}}`;
    if(/^g_[a-z][a-z0-9_]*$/i.test(name)){
      const globalName=name.slice(2).toLowerCase();
      items.push({sourceId:id,status:'pending',message:`Cadastre global.${globalName} no workspace; a variável global da Leona foi convertida, mas nenhum valor foi criado automaticamente.`});
      return `{{global.${globalName}}}`;
    }
    items.push({sourceId:id,status:'pending',message:`Confira a variável “${name}”, importada como campo personalizado.`});
    return `{{contact.customFields.${name}}}`;
  });
}

function strings(value:unknown,items:ImportReport['items'],id:string):unknown {
  if(typeof value==='string')return replaceVariables(value,items,id);
  if(Array.isArray(value))return value.map(item=>strings(item,items,id));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value as JsonObject).map(([key,item])=>[key,strings(item,items,id)]));
  return value;
}

export function isLeonaHostedUrl(url:string){try{const host=new URL(url).hostname.toLowerCase();return host.endsWith('.b-cdn.net')||host.includes('leona')}catch{return false}}
const triggerNote='O gatilho da Leona não vem no export. O fluxo foi importado para iniciar na mensagem recebida, uma vez por contato — confira antes de publicar.';
function flagLeonaFiles(out:JsonObject[],items:ImportReport['items'],id:string,type:string){
  const hosted=out.filter(item=>typeof item.url==='string'&&isLeonaHostedUrl(item.url));
  const stickers=hosted.filter(item=>item.type==='sticker').length;
  if(stickers)items.push({sourceId:id,sourceType:type,status:'pending',message:`${stickers} sticker(s) continuam hospedados na Leona e podem sair do ar; troque por um upload local.`});
  const total=hosted.length-stickers;
  if(total)items.push({sourceId:id,sourceType:type,status:'pending',message:`${total} arquivo(s) continuam hospedados na Leona e podem sair do ar se a conta for cancelada; suba-os em outro lugar e troque as URLs.`});
  return out;
}

function messageItems(config:JsonObject,items:ImportReport['items'],id:string){
  const actions=Array.isArray(config.items)?config.items:Array.isArray(config.actions)?config.actions:[];
  const converted:JsonObject[]=[];
  if(!actions.length&&text(config.text,config.message,config.content))converted.push({type:'text',text:replaceVariables(text(config.text,config.message,config.content)!,items,id),typingSeconds:0});
  for(const raw of actions){
    const action=object(raw);const type=String(text(action.type,action.action,action.kind)??'').toLowerCase();
    if(['text','send_message','message'].includes(type)){const body=text(action.text,action.message,action.message_text,action.content);if(body)converted.push({type:'text',text:replaceVariables(body,items,id),typingSeconds:Math.max(0,Math.min(60,num(action.typingSeconds??action.typing_delay_seconds??action.typing_delay)))})}
    else if(['file','send_file'].includes(type)){const url=text(action.url,action.fileUrl,action.file_url);if(url)converted.push({type:'file',url,fileName:text(action.fileName,action.file_name,action.name)??'arquivo',...(text(action.caption)?{caption:replaceVariables(text(action.caption)!,items,id)}:{})})}
    else if(['media','send_media'].includes(type)){const url=text(action.url,action.mediaUrl,action.media_url);if(url)converted.push({type:'media',mediaType:text(action.mediaType,action.media_type)??'image',url,...(text(action.caption)?{caption:replaceVariables(text(action.caption)!,items,id)}:{}),...(action.ptt===true?{ptt:true}:{})})}
    else if(['send_multi_media','multi_media'].includes(type)){for(const rawMedia of Array.isArray(action.items)?action.items:Array.isArray(action.media)?action.media:[]){const media=object(rawMedia);const url=text(media.url,media.mediaUrl,media.media_url);if(url)converted.push({type:'media',mediaType:text(media.mediaType,media.media_type,media.type)??'image',url,...(text(media.caption)?{caption:replaceVariables(text(media.caption)!,items,id)}:{})})}}
    else if(['contact','send_contact'].includes(type)){const name=text(action.name,action.contact_name,action.displayName);const phone=text(action.phone,action.contact_phone,action.number);if(name&&phone)converted.push({type:'contact',name:replaceVariables(name,items,id),phone:replaceVariables(phone,items,id)})}
    else if(['sticker','send_sticker'].includes(type)){const url=text(action.url,action.sticker_url,action.stickerUrl);if(url)converted.push({type:'sticker',url})}
    else if(['pause','delay_between_messages','delay'].includes(type)){const min=Math.max(0,Math.min(300,num(action.minSeconds??action.min_seconds??action.min_delay_seconds??action.seconds)));const max=Math.max(min,Math.min(300,num(action.maxSeconds??action.max_seconds??action.max_delay_seconds,min)));converted.push({type:'pause',minSeconds:min,maxSeconds:max})}
  }
  return converted.length?flagLeonaFiles(converted,items,id,'message'):[{type:'text',text:'Mensagem importada — revise o conteúdo.',typingSeconds:0}];
}

function conditionRules(config:JsonObject,items:ImportReport['items'],id:string,flowVariables=new Set<string>()){
  const source=Array.isArray(config.rules)?config.rules:Array.isArray(config.conditions)?config.conditions:[];
  const rules=source.map(raw=>{
    const rule=object(raw);let field=text(rule.field,rule.path,rule.key)??'last_message';const isTag=field==='system/tag'||field==='tag';
    if(isTag)field='contact.tagIds';
    else if(field==='custom_field'){const name=text(rule.name,rule.field_name,rule.customField)??'campo';field=flowVariables.has(name)?name:`contact.customFields.${name}`}
    const sourceOperator=text(rule.operator,rule.condition);const operator=isTag?(sourceOperator==='different'||sourceOperator==='not_in'?'not_in':'in'):(sourceOperator==='different'?'not_equals':sourceOperator??'equals');
    const rawValue=rule.value??rule.tags??rule.tag;const values=(Array.isArray(rawValue)?rawValue:[rawValue]).map(value=>typeof value==='string'?value:text(object(value).name,object(value).label,object(value).value)).filter((value):value is string=>Boolean(value?.trim())).map(value=>value.trim());
    return {field,operator,value:isTag?values:strings(rule.value,items,id)};
  });
  return {logic:(config.logic==='or'||config.logic==='any')?'any':'all',rules:rules.length?rules:[{field:'last_message',operator:'exists'}]};
}

function safeHeaders(value:unknown,items:ImportReport['items'],id:string){
  const headers:Record<string,string>={};
  for(const [key,raw] of Object.entries(object(value))){if(sensitiveKey.test(key)){items.push({sourceId:id,sourceType:'integration',status:'pending',message:'Um cabeçalho sensível não foi importado; configure-o no Nexo.'});continue}if(typeof raw==='string')headers[key]=raw}
  return headers;
}

type Item=ImportReport['items'][number];
const actionsOf=(node:JsonObject)=>{const list=object(node.data).actions;return Array.isArray(list)?list.map(object).filter(action=>typeof action.action_type==='string').sort((a,b)=>num(a.order)-num(b.order)):[]};
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const mediaUrl=(config:JsonObject,...keys:string[])=>text(...keys.map(key=>config[key]),object(config.media_file_info).direct_url,object(config.media_file_info).url);

function realMessageItems(actions:JsonObject[],items:ImportReport['items'],id:string,type:string){
  const out:JsonObject[]=[];const flag=(status:Item['status'],message:string)=>items.push({sourceId:id,sourceType:type,status,message});
  for(const action of actions){
    const c=object(action.config);const kind=action.action_type;
    if(kind==='send_message'){const body=text(c.message_text,c.message);if(!body){flag('pending','Mensagem sem texto (message_text/message) não foi importada.');continue}const delay=num(c.typing_delay_seconds);if(delay<0||delay>60)flag('adjusted','Tempo de digitação limitado a 0–60 segundos.');if(delay>0&&delay<3)flag('adjusted','Tempo de digitação mínimo é 3 segundos; o valor foi ajustado.');out.push({type:'text',text:replaceVariables(body,items,id),typingSeconds:delay>0?clamp(delay,3,60):0})}
    else if(kind==='send_file'){const url=mediaUrl(c,'file_url','url');if(!url){flag('pending','Arquivo sem URL (file_url) não foi importado.');continue}out.push({type:'file',url,fileName:text(c.file_name,object(c.media_file_info).filename)??'arquivo'})}
    else if(kind==='send_multi_media'){const url=mediaUrl(c,'url');if(!url){flag('pending','Mídia sem URL (media_file_info.direct_url) não foi importada.');continue}if(Array.isArray(c.messages)&&c.messages.length)flag('pending','Mensagens extras de “send_multi_media” (messages[]) não foram importadas.');const mediaType=['image','video','audio'].includes(String(c.media_type))?String(c.media_type):'image';const caption=text(c.caption);const delay=num(c.typing_delay_seconds);if(delay<0||delay>60)flag('adjusted','Tempo de digitação/gravação da mídia limitado a 0–60 segundos.');out.push({type:'media',mediaType,url,typingSeconds:clamp(delay,0,60),forwarded:c.audio_forward===true,...(mediaType==='audio'?{ptt:true}:{}),...(caption&&mediaType!=='audio'?{caption:replaceVariables(caption,items,id)}:{})})}
    else if(kind==='send_contact'){const name=text(c.contact_name,c.name);const phone=text(c.contact_phone,c.phone,c.phone_number);if(!name||!phone){flag('pending','Contato sem nome ou telefone não foi importado.');continue}out.push({type:'contact',name:replaceVariables(name,items,id),phone:replaceVariables(phone,items,id)})}
    else if(kind==='send_sticker'){const url=mediaUrl(c,'sticker_url','url');if(!url){flag('pending','Sticker sem URL não foi importado.');continue}out.push({type:'sticker',url})}
    else if(kind==='delay_between_messages'){const min=num(c.delay_min_seconds??c.delay_seconds);const max=num(c.delay_max_seconds??c.delay_seconds);if(min>300||max>300)flag('adjusted','Pausa limitada a 300 segundos.');const lo=clamp(min,0,300);out.push({type:'pause',minSeconds:lo,maxSeconds:clamp(Math.max(max,lo),lo,300)})}
    else flag('pending',`Ação “${String(kind)}” não é suportada em mensagens e foi ignorada.`);
  }
  if(!out.length){flag('pending','Mensagem sem conteúdo legível (message_text); revise o conteúdo.');return [{type:'text',text:'Mensagem importada — revise o conteúdo.',typingSeconds:0}]}
  return flagLeonaFiles(out,items,id,type);
}

const fieldOperators:Record<string,string>={contains:'contains',not_contains:'not_contains',equal:'equals',not_equal:'not_equals'};
function realConditionRules(c:JsonObject,items:ImportReport['items'],id:string,flowVariables:Set<string>){
  const rules:JsonObject[]=[];
  for(const raw of Array.isArray(c.conditions)?c.conditions:[]){
    const rule=object(raw);const tagName=text(rule.tagName);
    if(rule.category==='system'&&rule.systemSubtype==='tag'&&tagName&&['equal','not_equal'].includes(String(rule.systemOperator)))rules.push({field:'contact.tagIds',operator:rule.systemOperator==='equal'?'in':'not_in',value:[tagName.trim()]});
    else if(rule.category==='custom_field'&&text(rule.fieldName)&&fieldOperators[String(rule.fieldOperator)]){const fieldName=text(rule.fieldName)!;rules.push({field:flowVariables.has(fieldName)?fieldName:`contact.customFields.${fieldName}`,operator:fieldOperators[String(rule.fieldOperator)],value:strings(String(rule.fieldValue??''),items,id)})}
    else items.push({sourceId:id,sourceType:'condition',status:'pending',message:`Regra não suportada ignorada: ${JSON.stringify(rule)}`});
  }
  if(!rules.length)items.push({sourceId:id,sourceType:'condition',status:'pending',message:'Condicional sem regras legíveis; revise as condições.'});
  return {logic:c.ruleType==='any'?'any':'all',rules:rules.length?rules:[{field:'last_message',operator:'exists'}]};
}

const cleanFieldName=(value:unknown)=>text(value)?.trim().replace(/^\{+|\}+$/g,'');
function waitConfig(c:JsonObject,saveAction?:JsonObject){
  const unit=String(c.timeout_unit);const save=object(saveAction?.config);const field=cleanFieldName(save.field_name);
  return {waitIndefinitely:c.wait_indefinitely===true,timeoutValue:Math.max(1,num(c.timeout_value,1)),timeoutUnit:['minutes','hours','days'].includes(unit)?unit:'hours',bufferSeconds:c.buffer_enabled===true?clamp(num(c.buffer_value),0,300):0,...(field?{saveReplyTo:field,saveEmpty:save.save_empty!==false}:{}),...(c.react_to_lead_check_enabled===true&&text(c.react_to_lead_reaction_emoji)?{reactEmoji:text(c.react_to_lead_reaction_emoji)}:{}),replyToLeadCount:c.reply_to_lead_enabled===true?clamp(num(c.reply_to_lead_next_messages_count),0,10):0};
}

function normalizeNotificationPhone(countryCode:unknown,phone:unknown){
  const country=String(countryCode??'').replace(/\D/g,'');const local=String(phone??'').replace(/\D/g,'');
  // Leona exports a removed number as zeros; only a real subscriber number is kept.
  const joined=local.startsWith(country)&&country?local:`${country}${local}`;
  if(!/[1-9]/.test(joined.slice(country.length)))return undefined;
  return /^\d{8,15}$/.test(joined)&&joined[0]!=='0'?`+${joined}`:undefined;
}


const offsetMinutes=(ms:number,timeZone:string)=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(ms).map(x=>[x.type,x.value]));return Math.round((Date.UTC(+p.year!,+p.month!-1,+p.day!,+p.hour!,+p.minute!)-Math.floor(ms/60000)*60000)/60000)};
/** Wall time without offset read in `timeZone`, as ISO 8601 with offset. */
function wallToIso(value:string,timeZone:string){
  const m=/^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)/.exec(value);if(!m)return undefined;
  const base=Date.UTC(+m[1]!,+m[2]!-1,+m[3]!,+m[4]!,+m[5]!);let off=offsetMinutes(base,timeZone);off=offsetMinutes(base-off*60000,timeZone);
  const pad=(n:number)=>String(n).padStart(2,'0');return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00${off<0?'-':'+'}${pad(Math.floor(Math.abs(off)/60))}:${pad(Math.abs(off)%60)}`;
}
const SMART_UNITS:Record<string,string>={second:'seconds',seconds:'seconds',minute:'minutes',minutes:'minutes',hour:'hours',hours:'hours',day:'days',days:'days'};
/** Leona `smart_interval` by subtype. Unreadable settings return null (reported as pending) — never a silent duration. */
function smartInterval(c:JsonObject,items:ImportReport['items'],originalId:string,type:string,timezone:string){
  const pend=(message:string)=>{items.push({sourceId:originalId,sourceType:type,status:'pending',message});return null};
  const subtype=String(text(c.interval_type,c.subtype,c.mode,c.type)??'').toLowerCase();
  let candidate:unknown;
  if(['duration','interval','delay','fixed','wait'].includes(subtype)){
    const unit=SMART_UNITS[String(text(c.unit,c.time_unit)??'').toLowerCase()];const value=num(c.duration??c.value??c.amount,NaN);
    if(!unit||!Number.isFinite(value))return pend('Intervalo inteligente de duração ilegível (valor/unidade); configure o bloco manualmente.');
    candidate={mode:'duration',duration:value,unit};
  }else if(['date','datetime','specific_date'].includes(subtype)){
    const raw=text(c.run_at,c.runAt,c.datetime,c.date,c.scheduled_at);if(!raw)return pend('Intervalo inteligente por data sem a data; configure o bloco manualmente.');
    if(/(Z|[+-]\d\d(:?\d\d)?)$/i.test(raw))candidate={mode:'date',runAt:raw.replace(' ','T').replace(/([+-]\d\d)$/,'$1:00')};
    else{const zone=text(c.timezone)??timezone;try{new Intl.DateTimeFormat('en-US',{timeZone:zone})}catch{return pend(`Fuso horário “${zone}” do intervalo inteligente inválido; use um fuso IANA (ex.: America/Sao_Paulo) e configure o bloco manualmente.`)}const iso=wallToIso(raw,zone);if(!iso)return pend(`Data “${raw}” do intervalo inteligente ilegível; configure o bloco manualmente.`);
      items.push({sourceId:originalId,sourceType:type,status:'adjusted',message:`Data sem fuso interpretada em ${text(c.timezone)??timezone} (${iso}); confira.`});candidate={mode:'date',runAt:iso}}
  }else if(['schedule','business_hours','hours','time_window'].includes(subtype)){
    const list=[c.days,c.schedule,c.hours].find(Array.isArray) as unknown[]|undefined;
    const days=(list??[]).map(object).map(d=>({day:num(d.day??d.weekday,NaN),enabled:(d.enabled??d.active)===true,start:text(d.start,d.open,d.from)??'',end:text(d.end,d.close,d.to)??''}));
    if(!days.length)return pend('Intervalo inteligente por horários sem dias; configure o bloco manualmente.');
    candidate={mode:'schedule',...(text(c.timezone)?{timezone:text(c.timezone)}:{}),days};
  }else return pend(`Subtipo “${subtype||'desconhecido'}” do intervalo inteligente não reconhecido; configure o bloco manualmente.`);
  const parsed=AutomationDelayConfigSchema.safeParse(candidate);
  if(!parsed.success)return pend('Configuração do intervalo inteligente inválida; configure o bloco manualmente.');
  return parsed.data as JsonObject;
}

const MANIPULATOR_OPS:Record<string,string>={set:'set',define:'set',set_value:'set',assign:'set',add:'add',sum:'add',increment:'add',somar:'add',subtract:'subtract',sub:'subtract',decrement:'subtract',subtrair:'subtract',multiply:'multiply',mul:'multiply',multiplicar:'multiply',divide:'divide',div:'divide',dividir:'divide'};
const withoutSecrets=(value:unknown):JsonObject=>JSON.parse(JSON.stringify(value,(key,item)=>sensitiveKey.test(key)?undefined:item));
/** Leona `manipulator` / isolated `save_user_data`. An unknown operation stays blank (blocks publish) and the original config is kept in the report. */
function manipulatorNode(c:JsonObject,items:ImportReport['items'],originalId:string,type:string){
  const pend=(message:string)=>items.push({sourceId:originalId,sourceType:type,status:'pending',message,original:withoutSecrets(c)});
  const raw=cleanFieldName(text(c.field_name,c.variable_name,c.variable,c.field,c.target,c.name))??'';
  const target=/^(contact\.customFields|flow)\./.test(raw)?raw:raw?`contact.customFields.${raw}`:'';
  const opRaw=String(text(c.operation,c.operator,c.action)??(type==='save_user_data'?'set':'')).toLowerCase();const operation=MANIPULATOR_OPS[opRaw]??'';
  if(!target)pend('Campo do Manipulador ausente; escolha o destino após importar.');
  if(!operation)pend(`Operação “${opRaw||'desconhecida'}” do Manipulador não reconhecida; escolha a operação após importar.`);
  if(c.value===undefined||c.value===null)pend('Valor do Manipulador não encontrado na configuração original; informe o valor após importar.');
  const value=c.value===undefined||c.value===null?'':typeof c.value==='string'?replaceVariables(c.value,items,originalId):JSON.stringify(c.value);
  return {target,operation,value};
}

function mapNode(raw:JsonObject,index:number,items:ImportReport['items'],flowVariables:Set<string>,timezone:string){
  const originalId=sourceId(raw,index);const id=cleanId('leona',originalId);const type=nodeType(raw);const config=configOf(raw);
  const positionRaw=object(raw.position);const position={x:num(positionRaw.x,num(raw.x,index*260)),y:num(positionRaw.y,num(raw.y,160))};
  const name=text(raw.name,object(raw.data).label,object(raw.data).name)??type;
  const base={id,name,position};
  const acts=actionsOf(raw);
  if(type==='manipulator'||type==='save_user_data'){
    const first=acts.find(action=>action.action_type==='manipulator'||action.action_type==='save_user_data');
    return {...base,kind:'manipulator' as const,config:manipulatorNode(first?object(first.config):config,items,originalId,type)};
  }
  if(type==='chat_controller'){
    // The Leona state field name was never observed, so several spellings are accepted; an unrecognized value stays ATTENDING and is flagged.
    const c=acts.length?object(acts[0]!.config):config;const raw=String(text(c.state,c.status,c.chat_status,c.target_state,c.new_status,c.action)??'').toLowerCase();
    const state=({resolved:'RESOLVED',resolvido:'RESOLVED',resolvidos:'RESOLVED',closed:'RESOLVED',awaiting:'AWAITING',aguardando:'AWAITING',waiting:'AWAITING',pending:'AWAITING',attending:'ATTENDING',atendimento:'ATTENDING',in_progress:'ATTENDING',open:'ATTENDING'} as Record<string,'RESOLVED'|'AWAITING'|'ATTENDING'>)[raw.trim().replace(/[\s-]+/g,'_')];
    if(!state)items.push({sourceId:originalId,sourceType:type,status:'pending',message:'Estado do chat não reconhecido; o bloco foi importado como Atendimento. Revise o Controlador de Chat.'});
    return {...base,kind:'handoff' as const,config:{state:state??'ATTENDING',...(text(c.queue,c.team)?{queue:text(c.queue,c.team)}:{}),...(text(c.reason)?{reason:text(c.reason)}:{})}};
  }
  if(acts.length){
    const pend=(message:string)=>items.push({sourceId:originalId,sourceType:type,status:'pending',message});
    const expected:Record<string,string>={wait_response:'wait_for_response',condition:'evaluate_condition',ai:'ai_call',integration:'make_http_request',tags:'add_tags',pixel:'send_pixel_event',connection_flow:'execute_flow',distributor:'distribute_contacts',notification:'send_notification',smart_interval:'smart_interval'};
    const first=acts.find(action=>action.action_type===expected[type]);
    if(type==='message')return {...base,kind:'message' as const,config:{items:realMessageItems(acts,items,originalId,type)}};
    if(expected[type]){
      const supportedExtras=type==='wait_response'?new Set(['send_message','send_file','send_multi_media','save_user_data']):new Set<string>();
      for(const extra of acts.filter(action=>action!==first&&!supportedExtras.has(String(action.action_type))))pend(`Ação extra “${String(extra.action_type)}” não foi importada.`);
      if(!first)pend(`Bloco “${type}” sem a ação “${expected[type]}”; revise.`);
      else{
        const c=object(first.config);
        if(type==='wait_response'){
          const unit=String(c.timeout_unit);if(!['minutes','hours','days'].includes(unit))pend('Unidade de tempo do Aguarda Resposta (timeout_unit) não reconhecida; usando horas.');
          const save=acts.find(action=>action.action_type==='save_user_data');const field=cleanFieldName(object(save?.config).field_name);
          if(save&&!field)pend('Campo de save_user_data inválido; escolha o campo após importar.');
          return {...base,kind:'wait_response' as const,config:waitConfig(c,save)};
        }
        if(type==='condition')return {...base,kind:'condition' as const,config:realConditionRules(c,items,originalId,flowVariables)};
        if(type==='ai'){
          if(text(c.api_key))pend('A chave da IA não foi copiada. Configure a chave do workspace explicitamente.');
          if(Object.entries(c).some(([key,value])=>/^validate_receipt_/.test(key)&&value===true)||Object.entries(c).some(([key,value])=>/^expected_pix_key/.test(key)&&text(value)))pend('Validação de comprovante e chave Pix esperada não foram importadas.');
          if(!text(c.system_prompt))pend('Bloco de IA sem prompt (system_prompt); revise as instruções.');
          return {...base,kind:'ai' as const,config:{model:text(c.model)??'gpt-5.4-mini',systemPrompt:replaceVariables(text(c.system_prompt)??'Revise as instruções importadas.',items,originalId),userMessage:replaceVariables(text(c.user_message)??'{last_message}',items,originalId),understandImage:c.understand_image===true,understandPdf:c.understand_pdf===true,understandAudio:c.understand_audio===true,responseVariable:text(c.response_variable)??'resposta.gpt',failReasonVariable:text(c.fail_reason_variable)??'ai.fail.reason',autoSendResponse:c.auto_send_response===true,contextInteractions:clamp(num(c.context_interactions,1),1,20)}};
        }
        if(type==='integration'){
          if(!text(c.request_url))pend('Integração sem URL (request_url); revise.');
          const mapping=object(c.response_mapping);const body=c.request_body;
          const fields=(Array.isArray(c.response_fields)?c.response_fields:[]).map(object).filter(field=>text(field.path)).map(field=>({path:text(field.path)!,variable:text(mapping[String(field.name)],field.name)!}));
          return {...base,kind:'webhook' as const,config:{url:text(c.request_url)??'https://example.com/revise',method:String(text(c.request_method)??'POST').toUpperCase(),headers:safeHeaders(c.request_headers,items,originalId),...(typeof body==='string'?(body?{body:replaceVariables(body,items,originalId)}:{}):body!==undefined&&body!==null?{body:JSON.stringify(strings(body,items,originalId))}:{}),responseFields:fields}};
        }
        if(type==='pixel'){
          const label=text(c.event_type)??'';const found=PIXEL_EVENTS.find(event=>event.label.toLowerCase()===label.toLowerCase()||event.eventName.toLowerCase()===label.toLowerCase());
          if(!found)pend(`Evento do pixel “${label}” não reconhecido; escolha o evento.`);
          const tracking=text(c.tracking_type);if(tracking&&tracking.toLowerCase()!=='facebook')pend(`Rastreador “${tracking}” não é suportado; só Facebook.`);
          const currency=String(text(c.currency)??'BRL').toUpperCase();if(!/^[A-Z]{3}$/.test(currency))pend(`Moeda “${currency}” inválida; usando BRL.`);
          const value=text(typeof c.item_value==='number'?String(c.item_value):c.item_value);const pageId=text(c.page_id);
          return {...base,kind:'pixel' as const,config:{pixelName:text(c.pixel_config_name)??'',eventName:found?.eventName??'LeadSubmitted',...(value?{value:replaceVariables(value,items,originalId)}:{}),currency:/^[A-Z]{3}$/.test(currency)?currency:'BRL',...(pageId?{pageId}:{})}};
        }
        if(type==='tags'){
          const names=(Array.isArray(c.tags)?c.tags:[]).filter((value):value is string=>typeof value==='string'&&Boolean(value.trim()));
          if(!names.length)pend('Bloco de etiquetas sem nomes (tags); revise.');
          return {...base,kind:'tag' as const,config:{mode:c.action==='remove'?'remove':'add',tagIds:[],tags:names.length?names:['Etiqueta importada']}};
        }
        if(type==='connection_flow'){
          const leonaFlowId=typeof c.target_flow_id==='number'||typeof c.target_flow_id==='string'?c.target_flow_id:undefined;const targetName=text(c.target_flow_name);
          if(leonaFlowId===undefined&&!targetName)pend('Fluxo de destino não identificado; selecione-o após importar.');
          else pend(`Destino da Leona${targetName?` “${targetName}”`:''} precisa ser resolvido para um fluxo deste workspace.`);
          return {...base,kind:'flow_jump' as const,config:{...(leonaFlowId!==undefined?{leonaFlowId}:{}),...(targetName?{targetName}:{})}};
        }
        if(type==='distributor'){
          const outputs=(Array.isArray(c.outputs)?c.outputs:[]).map(object).slice(0,10).map((output,outputIndex)=>({id:cleanId('output',text(output.id)??String(outputIndex+1)),name:text(output.name)??`Saída ${outputIndex+1}`,weight:1}));
          if(outputs.length<2)pend('Distribuidor precisa de pelo menos duas saídas; revise o bloco.');
          if((Array.isArray(c.outputs)?c.outputs:[]).some(output=>num(object(output).quantity)>0))items.push({sourceId:originalId,sourceType:type,status:'adjusted',message:'Contadores do distribuidor recomeçam do zero.'});
          return {...base,kind:'distributor' as const,config:{outputs,preventRepeat:c.prevent_repeat!==false}};
        }
        if(type==='smart_interval'){const delayConfig=smartInterval(c,items,originalId,type,timezone);if(!delayConfig)return null;return {...base,kind:'delay' as const,config:delayConfig}}
        if(type==='notification'){
          const phone=normalizeNotificationPhone(c.country_code,c.phone);const message=text(c.message);
          if(!phone)pend('Telefone da notificação ausente ou inválido; preencha o campo Telefone em E.164 antes de publicar.');
          if(!message)pend('Notificação sem mensagem; revise o bloco.');
          return {...base,kind:'notification' as const,config:{phone:phone??'',message:replaceVariables(message??'Notificação importada — revise o conteúdo.',items,originalId),...(text(c.name)?{name:text(c.name)}:{})}};
        }
      }
    }
  }
  if(type==='start'||type==='trigger'){items.push({sourceId:originalId,sourceType:type,status:'pending',message:triggerNote});return {...base,kind:'trigger' as const,config:{event:'message.received',oncePerContact:true}}}
  if(type==='message'||type==='send_message'||type==='send_file'||type==='send_multi_media'||type==='delay_between_messages')return {...base,kind:'message' as const,config:{items:messageItems(config,items,originalId)}};
  if(type==='wait_response')return {...base,kind:'wait_response' as const,config:{waitIndefinitely:config.waitIndefinitely===true||config.wait_indefinitely===true,timeoutValue:Math.max(1,num(config.timeoutValue??config.timeout_value,1)),timeoutUnit:text(config.timeoutUnit,config.timeout_unit)??'hours',bufferSeconds:Math.max(0,Math.min(300,num(config.bufferSeconds??config.buffer_seconds))),...(cleanFieldName(config.saveReplyTo??config.save_reply_to)?{saveReplyTo:cleanFieldName(config.saveReplyTo??config.save_reply_to),saveEmpty:config.saveEmpty!==false&&config.save_empty!==false}:{}),...(text(config.reactEmoji,config.react_emoji)?{reactEmoji:text(config.reactEmoji,config.react_emoji)}:{}),replyToLeadCount:clamp(num(config.replyToLeadCount??config.reply_to_lead_count),0,10)}};
  if(type==='condition')return {...base,kind:'condition' as const,config:conditionRules(config,items,originalId,flowVariables)};
  if(type==='ai'||type==='ai_call'){
    if(text(config.api_key,config.apiKey))items.push({sourceId:originalId,sourceType:type,status:'pending',message:'A chave da IA não foi copiada. Configure a chave do workspace explicitamente.'});
    return {...base,kind:'ai' as const,config:{model:text(config.model)??'gpt-5.4-mini',systemPrompt:replaceVariables(text(config.systemPrompt,config.system_prompt,config.prompt)??'Revise as instruções importadas.',items,originalId),userMessage:replaceVariables(text(config.userMessage,config.user_message)??'{last_message}',items,originalId),understandImage:config.understandImage===true,understandPdf:config.understandPdf===true,responseVariable:text(config.responseVariable,config.response_variable)??'resposta.gpt',failReasonVariable:'ai.fail.reason',autoSendResponse:config.autoSendResponse===true,contextInteractions:Math.max(1,Math.min(20,num(config.contextInteractions,1)))}};
  }
  if(type==='integration'||type==='make_http_request')return {...base,kind:'webhook' as const,config:{url:text(config.url)??'https://example.com/revise',method:String(text(config.method)??'POST').toUpperCase(),headers:safeHeaders(config.headers,items,originalId),...(config.body!==undefined?{body:typeof config.body==='string'?replaceVariables(config.body,items,originalId):JSON.stringify(strings(config.body,items,originalId))}:{}),responseFields:Array.isArray(config.responseFields)?config.responseFields:[]}};
  if(type==='tags'||type==='add_tags'){
    const names=(Array.isArray(config.tags)?config.tags:Array.isArray(config.names)?config.names:[config.tag,config.name]).map(value=>typeof value==='string'?value:typeof value==='object'&&value?text((value as JsonObject).name,(value as JsonObject).label):undefined).filter((value):value is string=>Boolean(value));
    return {...base,kind:'tag' as const,config:{mode:'add',tagIds:[],tags:names.length?names:['Etiqueta importada']}};
  }
  if(type==='connection_flow'||type==='execute_flow'){
    const leonaFlowId=typeof config.target_flow_id==='number'||typeof config.target_flow_id==='string'?config.target_flow_id:undefined;const targetName=text(config.target_flow_name,config.targetName);
    items.push({sourceId:originalId,sourceType:type,status:'pending',message:`Destino da Leona${targetName?` “${targetName}”`:''} precisa ser resolvido para um fluxo deste workspace.`});
    return {...base,kind:'flow_jump' as const,config:{...(leonaFlowId!==undefined?{leonaFlowId}:{}),...(targetName?{targetName}:{})}};
  }
  if(type==='distributor'||type==='distribute_contacts'){
    const outputs=(Array.isArray(config.outputs)?config.outputs:[]).map(object).slice(0,10).map((output,outputIndex)=>({id:cleanId('output',text(output.id)??String(outputIndex+1)),name:text(output.name)??`Saída ${outputIndex+1}`,weight:1}));
    if((Array.isArray(config.outputs)?config.outputs:[]).some(output=>num(object(output).quantity)>0))items.push({sourceId:originalId,sourceType:type,status:'adjusted',message:'Contadores do distribuidor recomeçam do zero.'});
    return {...base,kind:'distributor' as const,config:{outputs,preventRepeat:config.prevent_repeat!==false}};
  }
  if(type==='notification'||type==='send_notification'){
    const phone=normalizeNotificationPhone(config.country_code,config.phone);if(!phone)items.push({sourceId:originalId,sourceType:type,status:'pending',message:'Telefone da notificação ausente ou inválido; preencha o campo Telefone em E.164 antes de publicar.'});
    return {...base,kind:'notification' as const,config:{phone:phone??'',message:replaceVariables(text(config.message)??'Notificação importada — revise o conteúdo.',items,originalId),...(text(config.name)?{name:text(config.name)}:{})}};
  }
  if(type==='smart_interval'){const delayConfig=smartInterval(config,items,originalId,type,timezone);return delayConfig?{...base,kind:'delay' as const,config:delayConfig}:null}
  if(type==='kanban'){
    const board=object(config.board);const column=object(config.column);const action=object(config.action);
    const boardName=text(config.boardName,config.board_name,config.board,board.name,board.label,action.boardName,action.board_name,object(action.board).name);
    const columnName=text(config.columnName,config.column_name,config.column,config.stageName,config.stage_name,column.name,column.label,action.columnName,action.column_name,object(action.column).name);
    if(boardName&&columnName){
      const rawMode=String(text(config.mode,action.mode,config.action)??'create_or_move').toLowerCase();
      const mode=['create_only','move_only','create_or_move'].includes(rawMode)?rawMode:'create_or_move';
      items.push({sourceId:originalId,sourceType:type,status:'adjusted',message:`Ação Kanban será ligada a “${boardName} / ${columnName}” no workspace de destino.`});
      return {...base,kind:'kanban' as const,config:{boardName,columnName,mode}};
    }
    items.push({sourceId:originalId,sourceType:type,status:'adjusted',message:'Kanban sem quadro e coluna foi removido como passagem neutra.'});
  }
  else if(type==='pixel')items.push({sourceId:originalId,sourceType:type,status:'pending',message:`Pixel não migrado${text(config.event,config.name)?`: ${text(config.event,config.name)}`:''}.`});
  else items.push({sourceId:originalId,sourceType:type,status:'pending',message:`Bloco “${type}” ainda não é suportado e foi removido como passagem neutra.`});
  return null;
}

function edgePort(handle:unknown){const value=String(handle??'').toLowerCase();if(value==='client-response'||value==='reply')return 'reply';if(value==='timeout')return 'timeout';if(value==='success')return 'success';if(value==='failure'||value==='error')return 'failure';return undefined}

export function convertLeonaFlow(payload:{nodes:JsonObject[];edges:JsonObject[];label?:string},workspaceTimezone='America/Bahia'):ConversionResult {
  const items:ImportReport['items']=[];const flowVariables=new Set<string>();
  for(const raw of payload.nodes){const type=nodeType(raw);const config=configOf(raw);const acts=actionsOf(raw);if(type==='ai'){const c=object(acts.find(action=>action.action_type==='ai_call')?.config??config);for(const value of [c.response_variable,c.fail_reason_variable,c.responseVariable,c.failReasonVariable]){const field=cleanFieldName(value);if(field)flowVariables.add(field)}}if(type==='integration'){const c=object(acts.find(action=>action.action_type==='make_http_request')?.config??config);for(const value of Object.values(object(c.response_mapping))){const field=cleanFieldName(value);if(field)flowVariables.add(field)}for(const rawField of Array.isArray(c.response_fields)?c.response_fields:[]){const field=object(rawField);const value=cleanFieldName(object(c.response_mapping)[String(field.name)]??field.variable??field.name);if(value)flowVariables.add(value)}}}
  const mapped=payload.nodes.map((node,index)=>{const id=sourceId(node,index);const mappedNode=mapNode(node,index,items,flowVariables,workspaceTimezone);const acts=actionsOf(node);const waitIndex=acts.findIndex(action=>action.action_type==='wait_for_response');const embedded=waitIndex<0?[]:acts.slice(0,waitIndex).filter(action=>['send_message','send_file','send_multi_media'].includes(String(action.action_type)));const beforeWait=mappedNode?.kind==='wait_response'&&embedded.length?{id:cleanId('leona',`${id}_message`),kind:'message' as const,name:`${mappedNode.name} — mensagem`,config:{items:realMessageItems(embedded,items,id,'wait_response')},position:{x:mappedNode.position.x,y:mappedNode.position.y}}:undefined;if(beforeWait&&mappedNode){mappedNode.position={x:mappedNode.position.x+40,y:mappedNode.position.y+40};items.push({sourceId:id,sourceType:'wait_response',status:'adjusted',message:'Mensagem embutida separada em um bloco Mensagem antes do Aguarda Resposta.'})}return {raw:node,id,node:mappedNode,beforeWait}});
  const kept=new Map(mapped.filter(entry=>entry.node).map(entry=>[entry.id,entry.node!]));const removed=new Set(mapped.filter(entry=>!entry.node).map(entry=>entry.id));
  const rawEdges=payload.edges.map((edge,index)=>({edge,index,source:text(edge.source)??'',target:text(edge.target)??''})).filter(edge=>edge.source&&edge.target);
  const outgoing=new Map<string,typeof rawEdges>();for(const edge of rawEdges)outgoing.set(edge.source,[...(outgoing.get(edge.source)??[]),edge]);
  let edges:Definition['edges']=mapped.flatMap(entry=>entry.beforeWait&&entry.node?[{id:cleanId('leona_edge',`${entry.id}_message_wait`),source:entry.beforeWait.id,target:entry.node.id,isDefault:false,priority:0}]:[]) as Definition['edges'];const keys=new Set(edges.map(edge=>`${edge.source}:${edge.target}:${edge.port??''}:${edge.isDefault}:${JSON.stringify(edge.condition??null)}`));
  function destinations(target:string,seen=new Set<string>()):string[]{if(kept.has(target))return[target];if(!removed.has(target)||seen.has(target))return[];seen.add(target);return(outgoing.get(target)??[]).flatMap(next=>destinations(next.target,new Set(seen)))}
  for(const current of rawEdges){if(!kept.has(current.source))continue;for(const target of destinations(current.target)){const sourceNode=kept.get(current.source)!;const targetEntry=mapped.find(entry=>entry.id===target);const targetId=targetEntry?.beforeWait?.id??kept.get(target)!.id;const handle=text(current.edge.sourceHandle,current.edge.source_handle);const port=edgePort(handle);const isCondition=sourceNode.kind==='condition';const isDefault=isCondition&&['failure','false','default','else'].includes(String(handle??'').toLowerCase());const distributorOutput=sourceNode.kind==='distributor'&&String(handle??'').startsWith('output-')?cleanId('output',String(handle).slice(7)):undefined;// A Leona pixel has a single port-less output; the runtime aborts when "failure" has no edge, so both ports go to the same block.
const ports:ReturnType<typeof edgePort>[]=port?[port]:sourceNode.kind==='pixel'?['success','failure']:[undefined];for(const p of ports){const condition=distributorOutput?{field:'distributor.output',operator:'equals' as const,value:distributorOutput}:undefined;const key=`${sourceNode.id}:${targetId}:${p??''}:${isDefault}:${JSON.stringify(condition??null)}`;if(keys.has(key))continue;keys.add(key);edges.push({id:cleanId('leona_edge',`${current.index}_${current.source}_${target}${p&&!port?`_${p}`:''}`),source:sourceNode.id,target:targetId,isDefault,priority:0,...(p&&!isCondition?{port:p}:{}),...(condition?{condition}:{}),...(text(current.edge.label)?{label:text(current.edge.label)}:{})})}}}
  // A condition whose matched and default branches reach the same block has no effect: drop it and re-link its inputs.
  const passthrough=()=>[...kept].find(([,node])=>{const out=edges.filter(edge=>edge.source===node.id);return node.kind==='condition'&&out.some(edge=>edge.isDefault)&&out.some(edge=>!edge.isDefault)&&new Set(out.map(edge=>edge.target)).size===1&&out[0]!.target!==node.id});
  for(let pass=passthrough();pass;pass=passthrough()){
    const [original,node]=pass;const target=edges.find(edge=>edge.source===node.id)!.target;
    edges=edges.filter(edge=>edge.source!==node.id).map(edge=>edge.target===node.id?{...edge,target}:edge);kept.delete(original);
    items.splice(0,items.length,...items.filter(item=>item.sourceId!==original));items.push({sourceId:original,sourceType:'condition',status:'adjusted',message:'Condição sem efeito removida: os dois caminhos iam para o mesmo bloco'});
  }
  const nodes=[...kept.values(),...mapped.flatMap(entry=>entry.beforeWait?[entry.beforeWait]:[])];let trigger=nodes.find(node=>node.kind==='trigger');
  if(!trigger){trigger={id:'leona_start',kind:'trigger',name:'Início',config:{event:'message.received',oncePerContact:true},position:{x:0,y:160}};nodes.unshift(trigger);items.push({status:'pending',message:triggerNote});const first=nodes[1];if(first)edges.unshift({id:'leona_edge_start',source:trigger.id,target:first.id,isDefault:false,priority:0});items.push({status:'adjusted',message:'Um bloco Início foi criado porque a origem não continha gatilho.'})}
  for(const entry of mapped.filter(entry=>kept.has(entry.id)&&entry.node!.kind!=='pixel'))if(!items.some(item=>item.sourceId===entry.id))items.push({sourceId:entry.id,sourceType:nodeType(entry.raw),status:'converted',message:`Bloco “${entry.node!.name}” convertido.`});
  const definition=AutomationDefinitionSchema.parse({start:trigger.id,nodes,edges,settings:{maxSteps:100,timeoutSeconds:300}});
  return {definition,report:report('leona',items),suggestedName:payload.label?.trim()||'Fluxo importado da Leona'};
}

export function redactDefinitionSecrets(definition:Definition){
  const items:ImportReport['items']=[];
  const scrub=(value:unknown,path:string,nodeId:string):unknown=>{
    if(Array.isArray(value))return value.map((item,index)=>scrub(item,`${path}.${index}`,nodeId));
    if(!value||typeof value!=='object')return value;
    const result:JsonObject={};
    for(const [key,item] of Object.entries(value as JsonObject)){
      if(sensitiveKey.test(key)){items.push({sourceId:nodeId,status:'pending',message:`Segredo removido de “${path}.${key}”; configure-o após importar.`});continue}
      if(path.endsWith('.headers')&&sensitiveKey.test(key)){items.push({sourceId:nodeId,status:'pending',message:`Cabeçalho sensível “${key}” removido; configure-o após importar.`});continue}
      result[key]=scrub(item,`${path}.${key}`,nodeId);
    }
    return result;
  };
  const cleaned={...definition,nodes:definition.nodes.map(node=>({...node,config:scrub(node.config,'config',node.id) as JsonObject}))};
  return {definition:AutomationDefinitionSchema.parse(cleaned),report:report('nexo',items)};
}
