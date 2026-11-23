import type {ContactConsentState} from './types';
const date=(value:string)=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(value));
/** Texto do estado atual do consentimento (pt-BR). */
export function consentStatus(consent:ContactConsentState|undefined){
  if(!consent)return {tone:'none' as const,text:'Sem consentimento registrado'};
  if(consent.optedOut)return {tone:'optout' as const,text:'Pediu para sair'};
  if(consent.given&&consent.at)return {tone:'given' as const,text:`Consentimento dado em ${date(consent.at)}${consent.source?` · origem: ${consent.source}`:''}`};
  if(consent.revokedAt)return {tone:'revoked' as const,text:`Consentimento revogado em ${date(consent.revokedAt)}${consent.source?` · origem: ${consent.source}`:''}`};
  return {tone:'none' as const,text:'Sem consentimento registrado'};
}
