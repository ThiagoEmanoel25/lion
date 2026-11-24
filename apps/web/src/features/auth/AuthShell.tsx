import type {ReactNode} from 'react';
import {APP_NAME,APP_TAGLINE} from '../../shared/brand';
import './login.css';
import './auth-forms.css';

/** Casca visual das telas públicas (convite e redefinição): reaproveita o layout do login. */
export function AuthShell({title,subtitle,children}:{title:string;subtitle?:string;children:ReactNode}){
  return <main className="login-page">
    <section className="login-card"><div className="login-card-brand"><span className="logo">{APP_NAME[0]}</span><div><b>{APP_NAME}</b><small>{APP_TAGLINE}</small></div></div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}{children}</section></main>
}
