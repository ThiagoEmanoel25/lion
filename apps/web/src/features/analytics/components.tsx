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
  return <section className={`analytics-state ${kind}`} role={kind==='error'?'alert':'status'}>{kind==='loading'?<><i/><div><b>Calculando resultados</b><p>Consolidando os dados deste workspace…</p></div></>:<div><b>Não foi possível carregar os resultados</b><p>Verifique a conexão e tente novamente.</p>{onRetry&&<button onClick={onRetry}>Tentar novamente</button>}</div>}</section>
}

const dayLabel=(date:string)=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));
const labelStep=(count:number)=>count<=8?1:count<=14?2:count<=31?5:15;

// Barras em tinta; a maior fica em destaque. Com `outcomes` mostra uma segunda série em cinza.
export function DailyChart({series,outcomes=false}:{series:AnalyticsOverview['series'];outcomes?:boolean}){
  const maximum=Math.max(1,...series.flatMap(point=>outcomes?[point.conversations,point.outcomes]:[point.conversations]));
  if(!series.some(point=>point.conversations||(outcomes&&point.outcomes)))return <div className="analytics-empty compact"><b>Nenhum movimento no período</b><p>As séries aparecerão quando novas conversas e desfechos forem registrados.</p></div>;
  const top=series.reduce((best,point)=>point.conversations>best.conversations?point:best,series[0]!);
  const step=labelStep(series.length);
  return <div className="dchart" role="img" aria-label={`Conversas por dia. Maior movimento em ${dayLabel(top.date)}, com ${top.conversations} conversa${top.conversations===1?'':'s'}.`}>
    <div className="dchart-plot">{series.map(point=><div key={point.date} className={point.date===top.date?'col top':'col'} title={`${dayLabel(point.date)}: ${point.conversations} conversa${point.conversations===1?'':'s'}${outcomes?`, ${point.outcomes} desfecho${point.outcomes===1?'':'s'}`:''}`}><i style={{height:`${point.conversations/maximum*100}%`}}/>{outcomes&&<i className="alt" style={{height:`${point.outcomes/maximum*100}%`}}/>}</div>)}</div>
    <div className="dchart-axis" aria-hidden="true">{series.map((point,index)=><span key={point.date}>{index%step===0||index===series.length-1&&step===1?dayLabel(point.date):''}</span>)}</div>
  </div>
}

export function ChannelSelect({channels,value,onChange}:{channels:AnalyticsOverview['channels'];value:string;onChange:(value:string)=>void}){
  if(!channels.length)return null;
  return <label className="period-select"><span>Conexão</span><select value={value} onChange={event=>onChange(event.target.value)}><option value="">Todas as conexões</option>{channels.map(channel=><option key={channel.id} value={channel.id}>{channel.name}{channel.status==='CONNECTED'?'':' (desconectada)'}</option>)}</select></label>
}

// Uma série só: sem legenda, e o rótulo fica de 3 em 3 horas para os 24 rótulos não colidirem.
export function HourChart({hours}:{hours:AnalyticsOverview['hours']}){
  const maximum=Math.max(1,...hours.map(point=>point.conversations));
  if(!hours.some(point=>point.conversations))return <div className="analytics-empty compact"><b>Sem conversas no período</b><p>A distribuição por horário aparece quando houver movimento.</p></div>;
  const busiest=hours.reduce((best,point)=>point.conversations>best.conversations?point:best,hours[0]!);
  const hh=(hour:number)=>String(hour).padStart(2,'0');
  return <div className="dchart hours" role="img" aria-label={`Movimento por horário. Pico às ${hh(busiest.hour)}h, com ${busiest.conversations} conversa${busiest.conversations===1?'':'s'}.`}>
    <div className="dchart-plot">{hours.map(point=><div key={point.hour} className={point.hour===busiest.hour?'col top':'col'} title={`${hh(point.hour)}h: ${point.conversations} conversa${point.conversations===1?'':'s'}`}><i style={{height:`${point.conversations/maximum*100}%`}}/></div>)}</div>
    <div className="dchart-axis" aria-hidden="true">{hours.map(point=><span key={point.hour}>{point.hour%6===0?`${hh(point.hour)}h`:''}</span>)}</div>
  </div>
}

export function ChannelBreakdown({rows}:{rows:AnalyticsOverview['byChannel']}){
  const total=rows.reduce((sum,row)=>sum+row.conversations,0);
  if(!rows.length)return <div className="analytics-empty"><b>Nenhuma conexão</b><p>Conecte um número para ver o movimento por conexão.</p></div>;
  const maximum=Math.max(1,...rows.map(row=>row.conversations));
  return <ul className="channel-rows">{rows.map(row=><li key={row.id}>
    <span><b>{row.name}</b><small>{row.phone}{row.status==='CONNECTED'?'':' · desconectada'}</small></span>
    <i><em style={{width:`${row.conversations/maximum*100}%`}}/></i>
    <strong>{row.conversations}{total?<small>{percent(row.conversations/total)}</small>:null}</strong>
  </li>)}</ul>
}
