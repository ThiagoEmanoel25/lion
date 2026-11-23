import {useState,type FormEvent} from 'react';import {Navigate,useLocation} from 'react-router-dom';import {useSession} from '../../app/providers/SessionProvider';import {APP_NAME,APP_TAGLINE} from '../../shared/brand';import './login.css';

export function LoginPage(){
  const {session,login,loading}=useSession();const location=useLocation();
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [error,setError]=useState('');const [fieldErrors,setFieldErrors]=useState<{email?:string;password?:string}>({});
  if(session)return <Navigate to={(location.state as {from?:string}|null)?.from??'/'} replace/>;
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setError('');const form=event.currentTarget;
    const errors:{email?:string;password?:string}={};
    if(!email.trim())errors.email='Informe seu e-mail.';else if(!/^[^\s@]+@[^\s@]+$/.test(email.trim()))errors.email='Informe um e-mail válido.';
    if(!password)errors.password='Informe sua senha.';else if(password.length<8)errors.password='A senha tem pelo menos 8 caracteres.';
    setFieldErrors(errors);
    const first=errors.email?'email':errors.password?'password':null;if(first){(form.elements.namedItem(first) as HTMLElement|null)?.focus();return}
    try{await login(email.trim(),password)}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível entrar.')}
  }
  return <main className="login-page"><section className="login-brand"><span className="logo">{APP_NAME[0]}</span><h1>Conversas que avançam.</h1><p>Atendimento humano e inteligência artificial trabalhando com o mesmo contexto.</p></section><section className="login-card"><div className="login-card-brand"><span className="logo">{APP_NAME[0]}</span><div><b>{APP_NAME}</b><small>{APP_TAGLINE}</small></div></div><small>ACESSO À OPERAÇÃO</small><h2>Entre no {APP_NAME}</h2><p>Use sua conta para acessar o workspace.</p>
    <form onSubmit={event=>void submit(event)} noValidate>
      <label>E-mail<input name="email" type="email" value={email} onChange={e=>{setEmail(e.target.value);setFieldErrors(state=>({...state,email:undefined}))}} autoComplete="email" aria-invalid={Boolean(fieldErrors.email)||undefined}/></label>{fieldErrors.email&&<div className="form-error" role="alert">{fieldErrors.email}</div>}
      <label>Senha<input name="password" type="password" value={password} onChange={e=>{setPassword(e.target.value);setFieldErrors(state=>({...state,password:undefined}))}} autoComplete="current-password" aria-invalid={Boolean(fieldErrors.password)||undefined}/></label>{fieldErrors.password&&<div className="form-error" role="alert">{fieldErrors.password}</div>}
      {error&&<div className="form-error" role="alert">{error}</div>}<button disabled={loading}>{loading?'Entrando…':'Entrar'}</button></form>
    {import.meta.env.DEV&&<em>Ambiente local de desenvolvimento</em>}</section></main>
}
