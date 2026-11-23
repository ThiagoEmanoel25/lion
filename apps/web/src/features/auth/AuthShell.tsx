import type {ReactNode} from 'react';
import {APP_NAME,APP_TAGLINE} from '../../shared/brand';
import './login.css';
import './auth-forms.css';

/** Casca visual das telas públicas (convite e redefinição): reaproveita o layout do login. */
export function AuthShell({eyebrow,title,subtitle,children}:{eyebrow:string;title:string;subtitle?:string;children:ReactNode}){
  return <main className="login-page"><section className="login-brand"><span className="logo">{APP_NAME[0]}</span><h1>Conversas que avançam.</h1><p>Atendimento humano e inteligência artificial trabalhando com o mesmo contexto.</p></section>
    <section className="login-card"><div className="login-card-brand"><span className="logo">{APP_NAME[0]}</span><div><b>{APP_NAME}</b><small>{APP_TAGLINE}</small></div></div><small>{eyebrow}</small><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}{children}</section></main>
}
