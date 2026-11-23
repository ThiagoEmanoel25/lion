export const PASSWORD_MIN=12;
export const PASSWORD_MAX=128;

export const ROLE_LABELS:Record<string,string>={OWNER:'Responsável pela conta',ADMIN:'Administrador',SUPERVISOR:'Supervisor',AGENT:'Atendente',VIEWER:'Leitor'};
export const roleLabel=(role:string)=>ROLE_LABELS[role]??role;

export function validateNewPassword(password:string):string|undefined{
  if(!password)return 'Informe a senha.';
  if(password.length<PASSWORD_MIN)return `A senha deve ter no mínimo ${PASSWORD_MIN} caracteres.`;
  if(password.length>PASSWORD_MAX)return `A senha deve ter no máximo ${PASSWORD_MAX} caracteres.`;
  return undefined;
}
export function validateConfirmation(password:string,confirmation:string):string|undefined{
  if(!confirmation)return 'Confirme a senha.';
  if(password!==confirmation)return 'As senhas não conferem.';
  return undefined;
}
export function validateName(name:string):string|undefined{
  const size=name.trim().length;
  if(size<2)return 'O nome deve ter pelo menos 2 caracteres.';
  if(size>100)return 'O nome deve ter no máximo 100 caracteres.';
  return undefined;
}

export const MSG_INVITE_INVALID='Este link não é mais válido. Peça um novo link a quem convidou você.';
export const MSG_RESET_INVALID='Este link não é mais válido. Peça um novo link ao administrador da sua conta.';
export const MSG_RATE_LIMIT='Muitas tentativas. Aguarde alguns minutos e tente de novo.';

type ErrorLike={status?:number;code?:string;message?:string;details?:unknown};
export type Translated={kind:'invalid'|'exists'|'rate'|'fields'|'generic';message:string;fields?:Record<string,string>};

/** Extrai `details.fieldErrors` (422) como um texto por campo. */
export function fieldErrorsOf(details:unknown):Record<string,string>{
  const raw=(details as {fieldErrors?:Record<string,unknown>}|undefined)?.fieldErrors;const out:Record<string,string>={};
  if(raw&&typeof raw==='object')for(const [key,value] of Object.entries(raw)){const first=Array.isArray(value)?value[0]:value;if(typeof first==='string'&&first)out[key]=first}
  return out;
}
const generic='Não foi possível concluir. Tente novamente.';
export function translateInviteError(error:unknown):Translated{
  const e=(error??{}) as ErrorLike;
  if(e.status===404||e.status===410||e.code==='INVALID_INVITE'||e.code==='INVITE_INVALID'||e.code==='INVITE_EXPIRED')return {kind:'invalid',message:MSG_INVITE_INVALID};
  if(e.status===409||e.code==='USER_EXISTS')return {kind:'exists',message:'Este e-mail já tem uma conta. Entre com seu e-mail e senha.'};
  if(e.status===429||e.code==='RATE_LIMITED')return {kind:'rate',message:MSG_RATE_LIMIT};
  if(e.status===422){const fields=fieldErrorsOf(e.details);if(fields.token)return {kind:'invalid',message:MSG_INVITE_INVALID};return {kind:'fields',message:'Confira os campos destacados.',fields}}
  return {kind:'generic',message:generic};
}
export function translateResetError(error:unknown):Translated{
  const e=(error??{}) as ErrorLike;
  if(e.status===400||e.status===404||e.status===410||e.code==='RESET_TOKEN_INVALID')return {kind:'invalid',message:MSG_RESET_INVALID};
  if(e.status===429||e.code==='RATE_LIMITED')return {kind:'rate',message:MSG_RATE_LIMIT};
  if(e.status===422){const fields=fieldErrorsOf(e.details);if(fields.token)return {kind:'invalid',message:MSG_RESET_INVALID};return {kind:'fields',message:'Confira os campos destacados.',fields}}
  return {kind:'generic',message:generic};
}
export function translateChangePasswordError(error:unknown):Translated{
  const e=(error??{}) as ErrorLike;
  if(e.status===401||e.code==='INVALID_CREDENTIALS')return {kind:'fields',message:'A senha atual está incorreta.',fields:{currentPassword:'A senha atual está incorreta.'}};
  if(e.code==='PASSWORD_UNCHANGED')return {kind:'fields',message:'A nova senha precisa ser diferente da atual.',fields:{newPassword:'A nova senha precisa ser diferente da atual.'}};
  if(e.status===429||e.code==='RATE_LIMITED')return {kind:'rate',message:'Muitas tentativas. Aguarde alguns minutos.'};
  if(e.status===422)return {kind:'fields',message:'Confira os campos destacados.',fields:fieldErrorsOf(e.details)};
  return {kind:'generic',message:generic};
}
