import {useState} from 'react';
import {MetricCard} from '../../components/MetricCard';
import type {AnalyticsOverview} from '../../shared/types/api';
import {useAnalyticsOverview} from './api/queries';
import type {AnalyticsPeriod} from '../dashboard/api/queries';
import {AnalyticsState,DailyChart,PeriodSelect,currency,percent,trend} from './components';
import './analytics.css';

function exportReport(data:AnalyticsOverview){
  const rows=[['data','conversas','desfechos','resolvidas'],...data.series.map(point=>[point.date,point.conversations,point.outcomes,point.resolved])];
  const csv=rows.map(row=>row.join(',')).join('\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=`resultados-${data.period.from.slice(0,10)}-${data.period.to.slice(0,10)}.csv`;anchor.click();URL.revokeObjectURL(url);
}

export function AnalyticsPage(){
  const [days,setDays]=useState<AnalyticsPeriod>(30);
  const query=useAnalyticsOverview(days);
  if(query.isLoading)return <div className="page"><AnalyticsState kind="loading"/></div>;
  if(query.isError||!query.data)return <div className="page"><AnalyticsState kind="error" onRetry={()=>query.refetch()}/></div>;
  const data=query.data;
  return <div className="page"><div className="heading"><div><small>INTELIGÊNCIA OPERACIONAL</small><h1>Resultados</h1><p>Conversão, resolução, qualidade operacional e custo calculados com dados reais.</p></div><div style={{display:'flex',gap:8}}><PeriodSelect value={days} onChange={setDays}/><button onClick={()=>exportReport(data)}>Exportar CSV</button></div></div>
    <div className={`insight ${data.insight?.tone==='positive'?'positive':data.insight?'':'empty'}`}><b>✦ {data.insight?.title||'Aguardando dados suficientes'}</b><p>{data.insight?.message||'O sistema mostrará oportunidades assim que houver conversas no período selecionado.'}</p></div>
    <div className="metrics three"><MetricCard label="Conversão geral" value={percent(data.summary.outcomeRate)} trend={trend(data.summary.trends.outcomes,'em desfechos')}/><MetricCard label="Resolução por automação" value={percent(data.summary.aiResolutionRate)} trend={`${data.summary.resolved} conversa${data.summary.resolved===1?' resolvida':'s resolvidas'}`} tone="blue"/><MetricCard label="Saúde operacional" value={`${data.health.score}/100`} trend={data.health.label} tone="purple"/></div>
    <div className="analytics-detail-grid"><section className="panel"><header><div><h2>Evolução diária</h2><p>Conversas iniciadas e desfechos registrados</p></div><span className="legend">● Conversas　<span>● Desfechos</span></span></header><DailyChart series={data.series}/></section><section className="panel"><header><div><h2>Eficiência</h2><p>Resumo do período selecionado</p></div></header><div className="analytics-breakdown"><div><span>Conversas</span><b>{data.summary.conversations}</b><small>{trend(data.summary.trends.conversations,'vs. anterior')}</small></div><div><span>Resolvidas</span><b>{data.summary.resolved}</b><small>{percent(data.summary.conversations?data.summary.resolved/data.summary.conversations:0)} das conversas</small></div><div><span>Custo total</span><b>{currency(data.summary.costCents)}</b><small>{trend(data.summary.trends.cost,'vs. anterior')}</small></div><div><span>Custo/desfecho</span><b>{currency(data.summary.costPerOutcomeCents)}</b><small>{data.summary.outcomes} desfechos</small></div></div></section></div>
    <section className="panel" style={{marginTop:13}}><header><div><h2>Desempenho dos playbooks</h2><p>Execuções das versões atualmente publicadas</p></div></header>{data.playbooks.length?data.playbooks.map(item=><div className="flow-row" key={item.id}><span>✦</span><div><b>{item.name} · v{item.version}</b><small>{item.executions} execuções · {item.succeeded} concluídas · {item.failed} falhas</small></div><em>{percent(item.successRate)}</em></div>):<div className="analytics-empty"><b>Sem playbooks ativos</b><p>Os resultados das automações aparecerão depois da publicação e execução.</p></div>}</section>
  </div>
}
