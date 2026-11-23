import {useState,type FormEvent} from 'react';
import {Link,useNavigate,useParams} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {useSession} from '../../app/providers/SessionProvider';
import {api} from '../../shared/api/client';
import {writeSession} from '../../shared/auth/session-storage';
import type {Session} from '../../shared/types/api';
import {LoadingState} from '../../shared/ui/AsyncState';
import {AuthShell} from './AuthShell';
import {PasswordField} from './PasswordField';
import {MSG_INVITE_INVALID,MSG_RATE_LIMIT,PASSWORD_MIN,roleLabel,translateInviteError,validateConfirmation,validateName,validateNewPassword} from './passwordRules';

type Invite={workspaceName:string;email:string;role:string;name:string|null;expiresAt:string};
type Errors={name?:string;password?:string;confirm?:string};

export function AcceptInvitePage(){
  const {token=''}=useParams();const navigate=useNavigate();const {session,logout}=useSession();
  const invite=useQuery({queryKey:['invite',token],queryFn:()=>api<Invite>(`/v1/invitations/${encodeURIComponent(token)}`),retry:false,staleTime:Infinity});
  const [name,setName]=useState<string|null>(null);const [password,setPassword]=useState('');const [confirm,setConfirm]=useState('');
  const [errors,setErrors]=useState<Errors>({});const [banner,setBanner]=useState('');const [expired,setExpired]=useState(false);const [busy,setBusy]=useState(false);

  if(invite.isLoading)return <AuthShell eyebrow="CONVITE" title="Aceitar convite"><LoadingState label="Verificando o convite…" lines={3}/></AuthShell>;
  if(invite.isError&&(invite.error as {status?:number}).status===429)return <AuthShell eyebrow="CONVITE" title="Aceitar convite"><p className="form-error" role="alert">{MSG_RATE_LIMIT}</p><button type="button" className="auth-secondary" onClick={()=>void invite.refetch()}>Tentar de novo</button></AuthShell>;
  if(invite.isError||!invite.data||expired)return <AuthShell eyebrow="CONVITE" title="Link inválido"><p className="auth-note" role="status">{MSG_INVITE_INVALID}</p><p className="auth-links"><Link to="/login">Ir para o login</Link></p></AuthShell>;
  const data=invite.data;
  if(session&&session.user.email.toLowerCase()!==data.email.toLowerCase())return <AuthShell eyebrow="CONVITE" title="Aceitar convite"><p className="auth-note warn" role="status">Você está conectado como {session.user.email}. Para aceitar este convite, saia dessa conta primeiro.</p><button type="button" className="auth-secondary" onClick={()=>void logout()}>Sair e continuar</button></AuthShell>;

  const currentName=name??data.name??'';
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBanner('');const form=event.currentTarget;
    const next:Errors={name:validateName(currentName),password:validateNewPassword(password),confirm:validateConfirmation(password,confirm)};
    setErrors(next);
    const first=(['name','password','confirm'] as const).find(key=>next[key]);
    if(first){(form.elements.namedItem(first) as HTMLElement|null)?.focus();return}
    setBusy(true);
    try{
      const result=await api<Session>('/v1/invitations/accept',{method:'POST',body:JSON.stringify({token,name:currentName.trim(),password})});
      writeSession(result);navigate('/',{replace:true});
    }catch(reason){
      const t=translateInviteError(reason);
      if(t.kind==='invalid'){setExpired(true);return}
      const fields=t.fields??{};const mapped:Errors={name:fields.name,password:fields.password};
      if(mapped.name||mapped.password){setErrors(mapped);((form.elements.namedItem(mapped.name?'name':'password')) as HTMLElement|null)?.focus()}else setBanner(t.message);
    }finally{setBusy(false)}
  }
  return <AuthShell eyebrow="CONVITE" title="Aceitar convite" subtitle="Defina seu nome e uma senha para entrar.">
    <dl className="auth-summary"><div><dt>Workspace</dt><dd>{data.workspaceName}</dd></div><div><dt>Seu papel</dt><dd>{roleLabel(data.role)}</dd></div></dl>
    <form onSubmit={event=>void submit(event)} noValidate>
      <div className="auth-field"><label htmlFor="invite-email">E-mail</label><input id="invite-email" name="email" type="email" value={data.email} readOnly autoComplete="username"/></div>
      <div className="auth-field"><label htmlFor="invite-name">Nome</label><input id="invite-name" name="name" value={currentName} onChange={e=>{setName(e.target.value);setErrors(s=>({...s,name:undefined}))}} autoComplete="name" aria-invalid={Boolean(errors.name)||undefined} aria-describedby={errors.name?'invite-name-err':undefined}/>{errors.name&&<div id="invite-name-err" className="form-error" role="alert">{errors.name}</div>}</div>
      <PasswordField label="Senha" name="password" value={password} onChange={v=>{setPassword(v);setErrors(s=>({...s,password:undefined}))}} error={errors.password} hint={`Regra: mínimo de ${PASSWORD_MIN} caracteres.`} autoComplete="new-password" toggleLabel="senha" disabled={busy}/>
      <PasswordField label="Confirmar senha" name="confirm" value={confirm} onChange={v=>{setConfirm(v);setErrors(s=>({...s,confirm:undefined}))}} error={errors.confirm} autoComplete="new-password" toggleLabel="confirmação da senha" disabled={busy}/>
      {banner&&<div className="form-error" role="alert">{banner}{banner.startsWith('Este e-mail já tem')&&<> <Link to="/login">Ir para o login</Link></>}</div>}
      <button disabled={busy}>{busy?'Criando conta…':'Criar conta e entrar'}</button>
    </form>
    <p className="auth-links">Já tem conta? <Link to="/login">Entrar</Link></p>
  </AuthShell>
}
