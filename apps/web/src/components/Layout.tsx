import {useState} from 'react';
import {NavLink,Outlet} from 'react-router-dom';
import {useSession} from '../app/providers/SessionProvider';
import './layout.css';

const groups=[
  {label:'PRINCIPAL',items:[['/','⌂','Dashboard'],['/inbox','▢','Chats ao vivo'],['/contacts','◎','Contatos']]},
  {label:'OPERAÇÕES',items:[['/playbooks','◇','Fluxos'],['/agents','✦','Agentes de IA'],['/connections','⌁','Conexões'],['/inbound-webhooks','⌘','Webhooks de entrada'],['/knowledge','▤','Conhecimento']]},
  {label:'GESTÃO',items:[['/analytics','↗','Resultados'],['/billing','▣','Cobranças e assinaturas'],['/settings','⚙','Configurações']]}
] as const;

export function Layout(){
  const {session,logout}=useSession();
  const [menuOpen,setMenuOpen]=useState(false);
  return <div className="shell">
    {menuOpen&&<button className="sidebar-backdrop" aria-label="Fechar menu" onClick={()=>setMenuOpen(false)}/>}
    <aside className={`sidebar ${menuOpen?'open':''}`}>
      <header><span className="logo">N</span><div><b>Nexo</b><small>conversas que avançam</small></div><button className="sidebar-close" aria-label="Fechar menu" onClick={()=>setMenuOpen(false)}>×</button></header>
      <nav>{groups.map(group=><section className="nav-group" key={group.label}><small>{group.label}</small>{group.items.map(([to,icon,label])=><NavLink key={to} to={to} end={to==='/' } onClick={()=>setMenuOpen(false)}><span>{icon}</span>{label}</NavLink>)}</section>)}</nav>
      <footer><span className="avatar">{session?.user.name.slice(0,2).toUpperCase()??'--'}</span><div><b>{session?.user.name}</b><small>{session?.workspace.role}</small></div><button onClick={()=>void logout()}>Sair</button></footer>
    </aside>
    <main><div className="topbar"><button className="mobile-menu-button" aria-label="Abrir menu" onClick={()=>setMenuOpen(true)}>☰</button><span>{session?.workspace.name}</span><div><i/> Sessão protegida</div></div><Outlet/></main>
  </div>
}
