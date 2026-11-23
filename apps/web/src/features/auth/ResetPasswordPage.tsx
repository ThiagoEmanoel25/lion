import {useState,type FormEvent} from 'react';
import {Link,useParams} from 'react-router-dom';
import {api} from '../../shared/api/client';
import {writeSession} from '../../shared/auth/session-storage';
import {AuthShell} from './AuthShell';
import {PasswordField} from './PasswordField';
import {MSG_RESET_INVALID,PASSWORD_MIN,translateResetError,validateConfirmation,validateNewPassword} from './passwordRules';

export function ResetPasswordPage(){
  const {token=''}=useParams();
  const [password,setPassword]=useState('');const [confirm,setConfirm]=useState('');const [errors,setErrors]=useState<{password?:string;confirm?:string}>({});
  const [banner,setBanner]=useState('');const [invalid,setInvalid]=useState(false);const [done,setDone]=useState(false);const [busy,setBusy]=useState(false);

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBanner('');const form=event.currentTarget;
    const next={password:validateNewPassword(password),confirm:validateConfirmation(password,confirm)};setErrors(next);
    const first=next.password?'password':next.confirm?'confirm':null;if(first){(form.elements.namedItem(first) as HTMLElement|null)?.focus();return}
    setBusy(true);
    try{
      // sem Bearer de outra conta: a confirmação é pública
      await api<void>('/v1/auth/password-reset/confirm',{method:'POST',body:JSON.stringify({token,password})},false);
      writeSession(null);setDone(true);
    }catch(reason){
      const t=translateResetError(reason);
      if(t.kind==='invalid'){setInvalid(true);return}
      if(t.fields?.password){setErrors({password:t.fields.password});(form.elements.namedItem('password') as HTMLElement|null)?.focus()}else setBanner(t.message);
    }finally{setBusy(false)}
  }
  if(done)return <AuthShell eyebrow="REDEFINIÇÃO DE SENHA" title="Tudo certo"><p className="auth-ok" role="status">Senha redefinida. Entre com a nova senha.</p><Link className="auth-link-button" to="/login">Ir para o login</Link></AuthShell>;
  if(invalid)return <AuthShell eyebrow="REDEFINIÇÃO DE SENHA" title="Link inválido"><p className="auth-note" role="status">{MSG_RESET_INVALID}</p><p className="auth-links"><Link to="/login">Ir para o login</Link></p></AuthShell>;
  return <AuthShell eyebrow="REDEFINIÇÃO DE SENHA" title="Redefinir senha" subtitle="Escolha uma nova senha para a sua conta.">
    <form onSubmit={event=>void submit(event)} noValidate>
      <PasswordField label="Nova senha" name="password" value={password} onChange={v=>{setPassword(v);setErrors(s=>({...s,password:undefined}))}} error={errors.password} hint={`Regra: mínimo de ${PASSWORD_MIN} caracteres.`} autoComplete="new-password" toggleLabel="nova senha" disabled={busy}/>
      <PasswordField label="Confirmar nova senha" name="confirm" value={confirm} onChange={v=>{setConfirm(v);setErrors(s=>({...s,confirm:undefined}))}} error={errors.confirm} autoComplete="new-password" toggleLabel="confirmação da nova senha" disabled={busy}/>
      {banner&&<div className="form-error" role="alert">{banner}</div>}
      <button disabled={busy}>{busy?'Salvando…':'Redefinir senha'}</button>
    </form>
    <p className="auth-links"><Link to="/login">Voltar ao login</Link></p>
  </AuthShell>
}
