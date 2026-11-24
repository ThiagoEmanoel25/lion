import {useRef,useState,type FormEvent} from 'react';
import {useSession} from '../../app/providers/SessionProvider';
import {api} from '../../shared/api/client';
import {readSession,writeSession} from '../../shared/auth/session-storage';
import {PasswordField} from '../auth/PasswordField';
import {PASSWORD_MIN,roleLabel,translateChangePasswordError,validateConfirmation,validateName,validateNewPassword} from '../auth/passwordRules';
import {useToast} from '../../shared/ui/Toast';
import '../../shared/ui/page-kit.css';
import './profile.css';

type Me={role:string;user:{id:string;name:string;email:string};workspace:{id:string;name:string}};

export function ProfilePage(){
  const {session}=useSession();const toast=useToast();
  if(!session)return null;
  return <div className="page ui-page profile-page">
    <header className="ui-head"><div><h1>Meu perfil</h1><p>Seus dados de acesso e a senha desta conta.</p></div></header>
    <div className="profile-grid">
      <NameCard name={session.user.name} email={session.user.email} role={session.workspace.role} workspace={session.workspace.name} onSaved={()=>toast.success('Nome atualizado.')}/>
      <PasswordCard onChanged={()=>toast.success('Senha alterada.')}/>
    </div>
  </div>
}

function NameCard({name,email,role,workspace,onSaved}:{name:string;email:string;role:string;workspace:string;onSaved:()=>void}){
  const [value,setValue]=useState(name);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const input=useRef<HTMLInputElement>(null);
  async function submit(event:FormEvent){
    event.preventDefault();const problem=validateName(value);setError(problem??'');if(problem){input.current?.focus();return}
    setBusy(true);
    try{
      const me=await api<Me>('/v1/auth/me',{method:'PATCH',body:JSON.stringify({name:value.trim()})});
      const current=readSession();if(current)writeSession({...current,user:{...current.user,name:me.user.name}});
      setValue(me.user.name);onSaved();
    }catch(reason){setError(reason instanceof Error&&reason.message?reason.message:'Não foi possível salvar o nome.');input.current?.focus()}
    finally{setBusy(false)}
  }
  return <section className="profile-card" aria-labelledby="perfil-dados">
    <h2 id="perfil-dados">Seus dados</h2>
    <dl className="profile-facts"><div><dt>Workspace</dt><dd>{workspace}</dd></div><div><dt>Papel</dt><dd>{roleLabel(role)}</dd></div></dl>
    <form onSubmit={event=>void submit(event)} noValidate>
      <div className="ui-field"><label htmlFor="perfil-email">E-mail</label><input id="perfil-email" value={email} readOnly/></div>
      <div className="ui-field"><label htmlFor="perfil-nome">Nome</label><input id="perfil-nome" ref={input} name="name" value={value} onChange={e=>{setValue(e.target.value);setError('')}} autoComplete="name" aria-invalid={Boolean(error)||undefined} aria-describedby={error?'perfil-nome-err':undefined}/>{error&&<div id="perfil-nome-err" className="form-error" role="alert">{error}</div>}</div>
      <button className="ui-btn primary profile-primary" disabled={busy||value.trim()===name}>{busy?'Salvando…':'Salvar nome'}</button>
    </form>
  </section>
}

type Errors={currentPassword?:string;newPassword?:string;confirm?:string};
function PasswordCard({onChanged}:{onChanged:()=>void}){
  const [current,setCurrent]=useState('');const [next,setNext]=useState('');const [confirm,setConfirm]=useState('');
  const [errors,setErrors]=useState<Errors>({});const [banner,setBanner]=useState('');const [busy,setBusy]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBanner('');const form=event.currentTarget;
    const found:Errors={currentPassword:current?undefined:'Informe a senha atual.',newPassword:validateNewPassword(next),confirm:validateConfirmation(next,confirm)};setErrors(found);
    const first=(['currentPassword','newPassword','confirm'] as const).find(key=>found[key]);
    if(first){(form.elements.namedItem(first) as HTMLElement|null)?.focus();return}
    setBusy(true);
    try{
      await api('/v1/auth/me'); // renova o token de acesso, se preciso, antes de ler o refreshToken atual
      const stored=readSession();
      await api<void>('/v1/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword:current,newPassword:next,refreshToken:stored?.refreshToken})},false);
      setCurrent('');setNext('');setConfirm('');setErrors({});onChanged();
    }catch(reason){
      const t=translateChangePasswordError(reason);const fields=t.fields??{};
      const mapped:Errors={currentPassword:fields.currentPassword,newPassword:fields.newPassword??fields.password};
      if(mapped.currentPassword||mapped.newPassword){setErrors(mapped);(form.elements.namedItem(mapped.currentPassword?'currentPassword':'newPassword') as HTMLElement|null)?.focus()}else setBanner(t.message);
    }finally{setBusy(false)}
  }
  return <section className="profile-card" aria-labelledby="perfil-senha">
    <h2 id="perfil-senha">Trocar senha</h2>
    <p className="profile-note">Ao trocar a senha, as outras sessões abertas com esta conta serão encerradas. Esta continua ativa.</p>
    <form onSubmit={event=>void submit(event)} noValidate>
      <PasswordField label="Senha atual" name="currentPassword" value={current} onChange={v=>{setCurrent(v);setErrors(s=>({...s,currentPassword:undefined}))}} error={errors.currentPassword} autoComplete="current-password" toggleLabel="a senha atual" disabled={busy}/>
      <PasswordField label="Nova senha" name="newPassword" value={next} onChange={v=>{setNext(v);setErrors(s=>({...s,newPassword:undefined}))}} error={errors.newPassword} hint={`Regra: mínimo de ${PASSWORD_MIN} caracteres.`} autoComplete="new-password" toggleLabel="a nova senha" disabled={busy}/>
      <PasswordField label="Confirmar nova senha" name="confirm" value={confirm} onChange={v=>{setConfirm(v);setErrors(s=>({...s,confirm:undefined}))}} error={errors.confirm} autoComplete="new-password" toggleLabel="a confirmação da nova senha" disabled={busy}/>
      {banner&&<div className="form-error" role="alert">{banner}</div>}
      <button className="ui-btn primary profile-primary" disabled={busy}>{busy?'Trocando…':'Trocar senha'}</button>
    </form>
  </section>
}
