import type {BroadcastAudience,BroadcastProgress} from './api/queries';

export const hasAudienceFilter=(audience:BroadcastAudience)=>audience.tagIds.length>0||audience.stages.length>0||audience.contactIds.length>0;

/** Corpo `audience` enviado à API: `allContacts:true` só quando não há filtro e a base inteira foi confirmada. */
export function buildAudiencePayload(audience:BroadcastAudience,allContacts:boolean){
  return {tagIds:audience.tagIds,stages:audience.stages,contactIds:audience.contactIds,...(allContacts&&!hasAudienceFilter(audience)?{allContacts:true}:{})};
}

/** Libera "Criar como rascunho": exige público definido (filtro, ou base inteira confirmada) e ao menos um elegível. */
export function canCreateBroadcast(input:{name:string;channelId:string;body:string;audience:BroadcastAudience;allContacts:boolean;confirmedAll:boolean;eligible:number;pending:boolean}){
  const scoped=hasAudienceFilter(input.audience)||(input.allContacts&&input.confirmedAll);
  return !input.pending&&Boolean(input.name.trim()&&input.channelId&&input.body.trim())&&scoped&&input.eligible>0;
}

const count=(value:number,one:string,many:string)=>`${value} ${value===1?one:many}`;
/** Ex.: "3 de 10 enviados · 2 ignorados · 1 falhou". Sem ignorados/falhas/cancelados quando for zero. */
export function progressSummary(progress:BroadcastProgress){
  const parts=[`${progress.sent} de ${progress.total} enviados`];
  if(progress.skipped)parts.push(count(progress.skipped,'ignorado','ignorados'));
  if(progress.failed)parts.push(count(progress.failed,'falhou','falharam'));
  if(progress.cancelled)parts.push(count(progress.cancelled,'cancelado','cancelados'));
  return parts.join(' · ');
}
/** Percentual concluído = tudo que já saiu da fila (enviado, ignorado, falho, cancelado). */
export const progressPercent=(progress:BroadcastProgress)=>progress.total?Math.round((progress.sent+progress.skipped+progress.failed+progress.cancelled)/progress.total*100):0;
