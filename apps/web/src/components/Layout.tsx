import {useEffect,useState} from 'react';
import {Link,NavLink,Outlet} from 'react-router-dom';
import {useSession} from '../app/providers/SessionProvider';
import {useBillingOverview} from '../features/billing/api/queries';
import {Bot,BookOpen,ChevronDown,Columns3,CreditCard,LayoutDashboard,MessageSquare,PanelLeftClose,PanelLeftOpen,Plug,Settings,TrendingUp,Users,Webhook,Workflow} from 'lucide-react';
import './layout.css';

const groups=[
  {label:'PRINCIPAL',items:[['/',LayoutDashboard,'Dashboard'],['/inbox',MessageSquare,'Chats ao vivo'],['/kanban',Columns3,'Kanban'],['/contacts',Users,'Contatos']]},
  {label:'OPERAÇÕES',items:[['/playbooks',Workflow,'Fluxos'],['/agents',Bot,'Agentes de IA'],['/connections',Plug,'Conexões'],['/inbound-webhooks',Webhook,'Webhooks de entrada'],['/knowledge',BookOpen,'Conhecimento']]},
  {label:'GESTÃO',items:[['/analytics',TrendingUp,'Resultados'],['/billing',CreditCard,'Cobranças e assinaturas'],['/settings',Settings,'Configurações']]}
] as const;
const number=(value:number)=>value.toLocaleString('pt-BR');

export function Layout(){
  const {session,logout}=useSession();
  const [menuOpen,setMenuOpen]=useState(false);
  const [collapsed,setCollapsed]=useState(()=>localStorage.getItem('nexo:sidebar')==='collapsed');
  useEffect(()=>{localStorage.setItem('nexo:sidebar',collapsed?'collapsed':'expanded')},[collapsed]);
  const billing=useBillingOverview();
  const contacts=billing.data?.resources.contacts;
  const executions=billing.data?.resources.executionsMonthly;
  const usedPercent=executions?.percentage===null||executions===undefined?null:Math.min(100,Math.round(executions.percentage*100));
  return <div className={`shell ${collapsed?'collapsed':''}`}>
    {menuOpen&&<button className="sidebar-backdrop" aria-label="Fechar menu" onClick={()=>setMenuOpen(false)}/>}
    <aside className={`sidebar ${menuOpen?'open':''}`}>
      <header>
        <span className="logo">N</span>
        <div><b>Nexo</b><small>conversas que avançam</small></div>
        <button className="sidebar-toggle" aria-label={collapsed?'Expandir menu':'Recolher menu'} aria-pressed={collapsed} title={collapsed?'Expandir menu':'Recolher menu'} onClick={()=>setCollapsed(value=>!value)}>{collapsed?<PanelLeftOpen size={18} aria-hidden="true"/>:<PanelLeftClose size={18} aria-hidden="true"/>}</button>
        <button className="sidebar-close" aria-label="Fechar menu" onClick={()=>setMenuOpen(false)}>×</button>
      </header>
      <Link className="workspace-card" to="/settings" onClick={()=>setMenuOpen(false)}>
        <div><b>{session?.workspace.name??'Workspace'}</b><small>{contacts?`Contatos: ${number(contacts.used)}`:session?.workspace.role}</small></div>
        <ChevronDown size={16} aria-hidden="true"/>
      </Link>
      <nav>{groups.map(group=><section className="nav-group" key={group.label}><small>{group.label}</small>{group.items.map(([to,Icon,label])=><NavLink key={to} to={to} end={to==='/'} title={label} onClick={()=>setMenuOpen(false)}><span><Icon size={18} aria-hidden="true"/></span>{label}</NavLink>)}</section>)}</nav>
      <div className="quota">
        <div><span>Execuções no mês</span><b>{executions?`${number(executions.used)}${executions.limit===null?'':` / ${number(executions.limit)}`}`:'—'}</b></div>
        <i><u style={{width:`${usedPercent??0}%`}}/></i>
        <small>{billing.data?`Plano ${billing.data.subscription.plan}`:'Carregando plano…'}</small>
        <Link to="/billing" onClick={()=>setMenuOpen(false)}>Gerenciar plano</Link>
      </div>
      <footer><span className="avatar">{session?.user.name.slice(0,2).toUpperCase()??'--'}</span><div><b>{session?.user.name}</b><small>{session?.workspace.role}</small></div><button onClick={()=>void logout()}>Sair</button></footer>
    </aside>
    <main><div className="topbar"><button className="mobile-menu-button" aria-label="Abrir menu" onClick={()=>setMenuOpen(true)}>☰</button><span>{session?.workspace.name}</span><div><i/> Sessão protegida</div></div><Outlet/></main>
  </div>
}
