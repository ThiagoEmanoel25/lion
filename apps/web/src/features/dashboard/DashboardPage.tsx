import {useState} from 'react';
import {Link} from 'react-router-dom';
import {MetricCard} from '../../components/MetricCard';
import {useSession} from '../../app/providers/SessionProvider';
import {AnalyticsState,DailyChart,PeriodSelect,currency,duration,percent,trend} from '../analytics/components';
import '../analytics/analytics.css';
import {useDashboard,type AnalyticsPeriod} from './api/queries';

const initials=(name:string|null)=>name?.split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase()||'CT';

export function DashboardPage(){
  const [days,setDays]=useState<AnalyticsPeriod>(7);
  const {session}=useSession();
  const query=useDashboard(days);
  const now=new Date();
  const greeting=now.getHours()<12?'Bom dia':now.getHours()<18?'Boa tarde':'Boa noite';
  const date=new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'long'}).format(now).toUpperCase();
  if(query.isLoading)return <div className="page"><AnalyticsState kind="loading"/></div>;
  if(query.isError||!query.data)return <div className="page"><AnalyticsState kind="error" onRetry={()=>query.refetch()}/></div>;
  const data=query.data;
  return <div className="page">
    <div className="heading"><div><small>{date}</small><h1>{greeting}, {session?.user.name.split(' ')[0]||'equipe'}.</h1><p>{data.summary.conversations?`A operação registrou ${data.summary.conversations} conversa${data.summary.conversations===1?'':'s'} e ${data.summary.outcomes} desfecho${data.summary.outcomes===1?'':'s'} no período.`:'Ainda não houve conversas neste período.'}</p></div><PeriodSelect value={days} onChange={setDays}/></div>
    <div className="metrics"><MetricCard label="Desfechos úteis" value={String(data.summary.outcomes)} trend={trend(data.summary.trends.outcomes,'vs. período anterior')}/><MetricCard label="Conversas abertas" value={String(data.summary.open)} trend="Fila atual do workspace" tone="orange"/><MetricCard label="1ª resposta média" value={duration(data.summary.averageFirstResponseSeconds)} trend={`${data.summary.conversations} conversa${data.summary.conversations===1?'':'s'} no período`} tone="blue"/><MetricCard label="Custo por desfecho" value={currency(data.summary.costPerOutcomeCents)} trend={`${currency(data.summary.costCents)} no período`} tone="purple"/></div>
    <div className="dashboard-grid"><section className="panel"><header><div><h2>Conversas e desfechos</h2><p>Resultado diário da operação</p></div><span className="legend">● Conversas　<span>● Desfechos</span></span></header><DailyChart series={data.series}/></section><section className="panel health"><header><div><h2>Saúde da operação</h2><p>Indicadores agregados, atualizados automaticamente</p></div></header><div className="score"><b>{data.health.score}</b><span><em>{data.health.label}</em><small>Visão operacional do workspace.</small></span></div>{data.health.signals.map(signal=><div className="health-row" key={signal.key}><i className={signal.status==='warning'?'warn':''}/><span>{signal.label}<small>{signal.detail}</small></span><b>{signal.status==='operational'?'Operacional':'Atenção'}</b></div>)}</section></div>
    <div className="dashboard-grid equal"><section className="panel"><header><div><h2>Precisam de atenção</h2><p>Intervenção humana recomendada</p></div></header>{data.attention.length?data.attention.map(item=><Link className="attention attention-link" to={`/inbox?conversation=${item.id}`} key={item.id}><span className="avatar">{initials(item.contact.name)}</span><div><b>{item.contact.name||item.contact.phone}</b><small>{item.reason}</small></div><em>Revisar</em></Link>):<div className="analytics-empty"><b>Nenhuma conversa prioritária</b><p>A fila não possui pendências que exijam atenção imediata.</p></div>}</section><section className="panel"><header><div><h2>Playbooks ativos</h2><p>Desempenho das versões publicadas</p></div></header>{data.playbooks.length?data.playbooks.map(item=><div className="flow-row" key={item.id}><span>✦</span><div><b>{item.name}</b><small>v{item.version} · {item.executions} execuções · {percent(item.successRate)} concluídas</small></div><em>ATIVO</em></div>):<div className="analytics-empty"><b>Nenhum playbook publicado</b><p>Publique um fluxo para acompanhar seu desempenho aqui.</p></div>}</section></div>
  </div>
}
