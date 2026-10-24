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

export function ChannelSelect({channels,value,onChange}:{channels:AnalyticsOverview['channels'];value:string;onChange:(value:string)=>void}){
  if(!channels.length)return null;
  return <label className="period-select"><span>Conexão</span><select value={value} onChange={event=>onChange(event.target.value)}><option value="">Todas as conexões</option>{channels.map(channel=><option key={channel.id} value={channel.id}>{channel.name}{channel.status==='CONNECTED'?'':' (desconectada)'}</option>)}</select></label>
}

// Uma série só: a cor não identifica nada, então nada de legenda, e o rótulo direto fica
// de 3 em 3 horas para os 24 rótulos não colidirem.
export function HourChart({hours}:{hours:AnalyticsOverview['hours']}){
  const maximum=Math.max(1,...hours.map(point=>point.conversations));
  if(!hours.some(point=>point.conversations))return <div className="analytics-empty compact"><b>Sem conversas no período</b><p>A distribuição por horário aparece quando houver movimento.</p></div>;
  const busiest=hours.reduce((best,point)=>point.conversations>best.conversations?point:best,hours[0]!);
  return <>
    <p className="chart-note">Pico às {String(busiest.hour).padStart(2,'0')}h, com {busiest.conversations} conversa{busiest.conversations===1?'':'s'}.</p>
    <div className="chart-scroll"><div className="bars real single" style={{minWidth:Math.max(520,hours.length*26)}}>{hours.map(point=><div key={point.hour} title={`${String(point.hour).padStart(2,'0')}h: ${point.conversations} conversa${point.conversations===1?'':'s'}`}><i style={{height:`${point.conversations/maximum*100}%`}}/><small>{point.hour%3===0?`${String(point.hour).padStart(2,'0')}h`:''}</small></div>)}</div></div>
  </>
}

export function ChannelBreakdown({rows}:{rows:AnalyticsOverview['byChannel']}){
  const total=rows.reduce((sum,row)=>sum+row.conversations,0);
  if(!rows.length)return <div className="analytics-empty"><b>Nenhuma conexão</b><p>Conecte um número para ver o movimento por conexão.</p></div>;
  const maximum=Math.max(1,...rows.map(row=>row.conversations));
  return <div className="channel-rows">{rows.map(row=><div key={row.id}>
    <span><b>{row.name}</b><small>{row.phone}{row.status==='CONNECTED'?'':' · desconectada'}</small></span>
    <i><em style={{width:`${row.conversations/maximum*100}%`}}/></i>
    <b>{row.conversations}{total?<small>{percent(row.conversations/total)}</small>:null}</b>
  </div>)}</div>
}
