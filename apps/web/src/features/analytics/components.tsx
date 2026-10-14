import type {AnalyticsOverview} from '../../shared/types/api';
import type {AnalyticsPeriod} from '../dashboard/api/queries';

export const currency=(cents:number|null)=>cents===null?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
export const percent=(value:number)=>new Intl.NumberFormat('pt-BR',{style:'percent',maximumFractionDigits:1}).format(value);
export const duration=(seconds:number|null)=>seconds===null?'—':seconds<60?`${seconds}s`:`${Math.floor(seconds/60)}min ${seconds%60}s`;
export const trend=(value:number|null,subject:string)=>value===null?'Sem base anterior':value===0?'Estável vs. período anterior':`${value>0?'↗':'↓'} ${percent(Math.abs(value))} ${subject}`;

export function PeriodSelect({value,onChange}:{value:AnalyticsPeriod;onChange:(value:AnalyticsPeriod)=>void}){
  return <label className="period-select"><span>Período</span><select value={value} onChange={event=>onChange(Number(event.target.value) as AnalyticsPeriod)}><option value={7}>Últimos 7 dias</option><option value={30}>Últimos 30 dias</option><option value={90}>Últimos 90 dias</option></select></label>
}

export function AnalyticsState({kind,onRetry}:{kind:'loading'|'error';onRetry?:()=>void}){
  return <section className={`analytics-state ${kind}`} role={kind==='error'?'alert':'status'}>{kind==='loading'?<><i/><div><b>Calculando resultados</b><p>Consolidando os dados deste workspace…</p></div></>:<><span>!</span><div><b>Não foi possível carregar os resultados</b><p>Verifique a conexão e tente novamente.</p>{onRetry&&<button onClick={onRetry}>Tentar novamente</button>}</div></>}</section>
}

export function DailyChart({series}:{series:AnalyticsOverview['series']}){
  const maximum=Math.max(1,...series.flatMap(point=>[point.conversations,point.outcomes]));
  if(!series.some(point=>point.conversations||point.outcomes))return <div className="analytics-empty compact"><b>Nenhum movimento no período</b><p>As séries aparecerão quando novas conversas e desfechos forem registrados.</p></div>;
  return <div className="chart-scroll"><div className="bars real" style={{minWidth:Math.max(520,series.length*34)}}>{series.map(point=><div key={point.date} title={`${point.date}: ${point.conversations} conversas, ${point.outcomes} desfechos`}><i style={{height:`${point.conversations/maximum*100}%`}}/><i style={{height:`${point.outcomes/maximum*100}%`}}/><small>{new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',timeZone:'UTC'}).format(new Date(`${point.date}T12:00:00Z`))}</small></div>)}</div></div>
}
