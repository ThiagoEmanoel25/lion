import {DomainError} from '@nexo/domain';

/**
 * Regras de consentimento (LGPD) do contato.
 * - given:true grava consentAt=agora, origem e autor; limpa consentRevokedAt.
 * - given:false limpa consentAt (o disparo exige consentAt) e grava consentRevokedAt/origem/autor; a trilha anterior fica na auditoria.
 * - Opt-out (optedOutAt, gravado pelo runtime em SAIR/PARAR) nunca é desfeito por given:true sozinho:
 *   exige reconsent:true explícito, senão 409 CONTACT_OPTED_OUT.
 * - Quem já consentiu mantém a data da prova original (given:true repetido é idempotente).
 */
export type ConsentInput={given:boolean;source:string;reconsent?:boolean};
type ConsentState={consentAt:Date|null;optedOutAt:Date|null};

export type ConsentPlan={kind:'noop'}|{kind:'blocked'}|{kind:'update';action:'granted'|'reconsented'|'revoked';data:Record<string,unknown>};

export function planConsent(current:ConsentState|null,input:ConsentInput,actorId:string,now=new Date()):ConsentPlan{
  if(input.given){
    const optedOut=Boolean(current?.optedOutAt);
    if(optedOut&&!input.reconsent)return {kind:'blocked'};
    if(!optedOut&&current?.consentAt)return {kind:'noop'};
    return {kind:'update',action:optedOut?'reconsented':'granted',data:{consentAt:now,consentSource:input.source,consentById:actorId,consentRevokedAt:null,...(optedOut?{optedOutAt:null}:{})}};
  }
  if(!current?.consentAt)return {kind:'noop'};
  return {kind:'update',action:'revoked',data:{consentAt:null,consentSource:input.source,consentById:actorId,consentRevokedAt:now}};
}

export const optedOutError=()=>new DomainError('CONTACT_OPTED_OUT','O contato pediu para sair da lista. Para reativar, confirme explicitamente com reconsent:true.',409);

/** Estado público do consentimento; omite colunas internas (autor) e nunca expõe outro workspace. */
export function withConsent<T extends {consentAt:Date|null;consentSource:string|null;consentRevokedAt:Date|null;optedOutAt:Date|null}>(contact:T){
  const {consentSource,consentById:_by,consentRevokedAt,...rest}=contact as T&{consentById?:string|null};
  return {...rest,consent:{given:contact.consentAt!=null,at:contact.consentAt,source:consentSource,revokedAt:consentRevokedAt,optedOut:contact.optedOutAt!=null,eligible:contact.consentAt!=null&&contact.optedOutAt==null}};
}
