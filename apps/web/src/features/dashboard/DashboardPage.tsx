import {useState} from 'react';
import {Link} from 'react-router-dom';
import {useSession} from '../../app/providers/SessionProvider';
import {AnalyticsState,ChannelBreakdown,ChannelSelect,DailyChart,HourChart,PeriodSelect,duration,percent,trend} from '../analytics/components';
import '../analytics/analytics.css';
import {Onboarding} from '../onboarding/Onboarding';
import {useDashboard,type AnalyticsPeriod} from './api/queries';
import './dashboard.css';

const waiting=(iso:string)=>{
  const minutes=Math.max(0,Math.round((Date.now()-new Date(iso).getTime())/60000));
  if(minutes<1)return 'agora';
  if(minutes<60)return `há ${minutes} min`;
  const hours=Math.floor(minutes/60);
  if(hours<24)return `há ${hours} h`;
  const days=Math.floor(hours/24);
  return `há ${days} dia${days===1?'':'s'}`;
};
const tone=(value:number|null)=>value===null||value===0?'':value>0?'up':'down';

export function DashboardPage(){
  const [days,setDays]=useState<AnalyticsPeriod>(7);
  const [channelId,setChannelId]=useState('');
  const {session}=useSession();
  const query=useDashboard(days,channelId||undefined);
  const now=new Date();
  const greeting=now.getHours()<12?'Bom dia':now.getHours()<18?'Boa tarde':'Boa noite';
  const date=new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'long'}).format(now).toUpperCase();
  if(query.isLoading)return <div className="page"><AnalyticsState kind="loading"/></div>;
  if(query.isError||!query.data)return <div className="page"><AnalyticsState kind="error" onRetry={()=>query.refetch()}/></div>;
  const data=query.data;
  const s=data.summary;
  const channelName=channelId?data.channels.find(channel=>channel.id===channelId)?.name:undefined;
  const queueSize=data.attention.length;
  const plural=(n:number)=>n===1?'':'s';
  return <div className="page dash">
    <div className="heading"><div><small>{date}</small><h1>{greeting}, {session?.user.name.split(' ')[0]||'equipe'}.</h1><p>{s.conversations?`${channelName?`${channelName}: `:'A operação registrou '}${s.conversations} conversa${plural(s.conversations)} e ${s.outcomes} desfecho${plural(s.outcomes)} no período.`:'Ainda não houve conversas neste período.'}</p></div><div className="heading-filters"><ChannelSelect channels={data.channels} value={channelId} onChange={setChannelId}/><PeriodSelect value={days} onChange={setDays}/></div></div>

    <section className="dash-block" aria-labelledby="dash-attention"><header><h2 id="dash-attention">Precisam de atenção</h2><p>Conversas que esperam por uma pessoa</p></header>
      {queueSize?<ul className="dash-queue">{data.attention.map(item=><li key={item.id}>
        <div><b>{item.contact.name||item.contact.phone}</b><small>{item.reason}</small></div>
        <time dateTime={item.updatedAt} title={new Date(item.updatedAt).toLocaleString('pt-BR')}>{waiting(item.updatedAt)}</time>
        <Link className="dash-open" to={`/inbox?conversation=${item.id}`} aria-label={`Abrir conversa com ${item.contact.name||item.contact.phone}`}>Abrir</Link>
      </li>)}</ul>:<div className="analytics-empty"><b>Nenhuma conversa prioritária</b><p>A fila não possui pendências que exijam atenção imediata.</p></div>}
    </section>

    <Onboarding/>

    <div className="dash-kpis" role="group" aria-label="Números do período">
      <div><strong>{s.open}</strong><span>Conversas abertas</span><small>Fila atual do workspace</small></div>
      <div><strong>{queueSize>=5?'5+':queueSize}</strong><span>Aguardando atendimento</span><small>Precisam de resposta humana</small></div>
      <div><strong>{duration(s.averageFirstResponseSeconds)}</strong><span>1ª resposta média</span><small>{s.conversations} conversa{plural(s.conversations)} no período</small></div>
      <div><strong>{s.leads}</strong><span>Leads novos</span><small className={tone(s.trends.leads)}>{trend(s.trends.leads,'vs. período anterior')}</small></div>
    </div>

    <div className="dash-pair">
      <section className="dash-block"><header><h2>Conversas por dia</h2><p>Novas conversas no período, maior dia em destaque</p></header><DailyChart series={data.series}/></section>
      <section className="dash-block"><header><h2>Movimento por horário</h2><p>Quando as conversas chegam, no fuso do workspace</p></header><HourChart hours={data.hours}/></section>
    </div>

    <div className="dash-trio">
      <section className="dash-block"><header><h2>Por conexão</h2><p>Conversas abertas no período, em todas as conexões</p></header><ChannelBreakdown rows={data.byChannel}/></section>
      <section className="dash-block"><header><h2>Playbooks ativos</h2><p>Desempenho das versões publicadas</p></header>{data.playbooks.length?<ul className="dash-list">{data.playbooks.map(item=><li key={item.id}><div><b>{item.name}</b><small>v{item.version} · {item.executions} execuções · {percent(item.successRate)} concluídas</small></div><span className="dash-state">Ativo</span></li>)}</ul>:<div className="analytics-empty"><b>Nenhum playbook publicado</b><p>Publique um fluxo para acompanhar seu desempenho aqui.</p></div>}</section>
      <section className="dash-block"><header><h2>Saúde da operação</h2><p>Indicadores atualizados automaticamente</p></header><p className="dash-score"><strong>{data.health.score}</strong><span>{data.health.label}</span></p><ul className="dash-list">{data.health.signals.map(signal=><li key={signal.key}><div><b>{signal.label}</b><small>{signal.detail}</small></div><span className={signal.status==='operational'?'dash-state':'dash-state warn'}>{signal.status==='operational'?'Operacional':'Atenção'}</span></li>)}</ul></section>
    </div>
  </div>
}
