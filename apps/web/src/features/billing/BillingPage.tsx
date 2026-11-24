import {ErrorState,LoadingState} from '../../shared/ui/AsyncState';import type {BillingOverview,BillingQuota} from '../../shared/types/api';import {useBillingOverview} from './api/queries';import {PLAN_LABELS,PROVIDER_LABELS,SUBSCRIPTION_STATUS_LABELS,label} from '../settings/labels';import '../../shared/ui/page-kit.css';import './billing.css';
// PAGAMENTO DESLIGADO NO PILOTO (decisão 2026-11-23): reativar quando houver gateway
const PILOT_NOTICE='A cobrança ainda não está disponível no piloto. Seu uso e seus limites continuam visíveis aqui.';
const labels={contacts:'Contatos',members:'Membros',channels:'Canais',executionsMonthly:'Execuções no mês'} as const;const number=(value:number)=>new Intl.NumberFormat('pt-BR').format(value);const date=(value:string)=>new Intl.DateTimeFormat('pt-BR').format(new Date(value));
function exportUsage(data:BillingOverview){const rows=[['métrica','uso','limite','projeção','excedente'],...Object.entries(data.resources).map(([key,value])=>[labels[key as keyof typeof labels],value.used,value.limit??'ilimitado',value.projected,value.overage])];const url=URL.createObjectURL(new Blob([rows.map(row=>row.join(',')).join('\n')],{type:'text/csv;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`uso-${data.subscription.currentPeriodStart.slice(0,10)}.csv`;anchor.click();URL.revokeObjectURL(url)}
const quotaState={exceeded:{text:'Limite atingido',tone:'bad'},warning:{text:'Atenção',tone:'warn'}} as const;
function QuotaRow({name,value}:{name:string;value:BillingQuota}){
  const width=value.percentage===null?0:Math.min(100,value.percentage*100);const state=quotaState[value.status as keyof typeof quotaState]??{text:'Dentro do plano',tone:'on'};
  return <li className={`billing-quota ${value.status}`}>
    <span className="quota-name">{name}</span>
    <b className="quota-use">{number(value.used)} <small>/ {value.limit===null?'Ilimitado':number(value.limit)}</small></b>
    <div className="quota-bar" aria-hidden="true"><i style={{width:`${width}%`}}/></div>
    <span className={`ui-status ${state.tone}`}>{state.text}</span>
    {name==='Execuções no mês'&&<p>Projeção até o fim do período: {number(value.projected)}{value.overage>0?` · ${number(value.overage)} acima do limite`:''}</p>}
  </li>
}
export function BillingPage(){
  const query=useBillingOverview();
  if(query.isLoading)return <div className="page ui-page"><LoadingState/></div>;
  if(query.isError||!query.data)return <div className="page ui-page"><ErrorState error={query.error} retry={()=>query.refetch()}/></div>;
  const data=query.data;const maximum=Math.max(1,...data.history.executions.map(item=>item.count));
  return <div className="page ui-page billing-page">
    <header className="ui-head"><div><h1>Cobranças e assinaturas</h1><p>Plano, cotas e consumo real deste workspace.</p></div><div className="ui-head-actions"><button type="button" className="ui-btn" onClick={()=>exportUsage(data)}>Exportar uso</button></div></header>
    <section className="billing-section billing-plan"><h2>Plano atual</h2>
      <dl><div><dt>Plano</dt><dd>{label(PLAN_LABELS,data.subscription.plan)}</dd></div><div><dt>Status</dt><dd>{label(SUBSCRIPTION_STATUS_LABELS,data.subscription.status)}</dd></div><div><dt>Período</dt><dd>{date(data.subscription.currentPeriodStart)} até {date(data.subscription.currentPeriodEnd)}</dd></div><div><dt>Cobrança</dt><dd>{data.subscription.provider==='local'?'Gerenciado localmente':label(PROVIDER_LABELS,data.subscription.provider)}</dd></div></dl>
    </section>
    <section className="billing-section"><h2>Uso e limites</h2><ul className="ui-rows billing-quotas">{Object.entries(data.resources).map(([key,value])=><QuotaRow key={key} name={labels[key as keyof typeof labels]} value={value}/>)}</ul></section>
    <section className="billing-section"><h2>Execuções por mês</h2><p className="ui-help">Histórico dos últimos seis meses.</p>{data.history.executions.some(item=>item.count)?<div className="billing-chart">{data.history.executions.map(item=><div key={item.month}><span><i style={{height:`${item.count/maximum*100}%`}}/></span><b>{item.count}</b><small>{new Intl.DateTimeFormat('pt-BR',{month:'short',timeZone:'UTC'}).format(new Date(`${item.month}-15T12:00:00Z`))}</small></div>)}</div>:<p className="ui-empty">Nenhuma execução registrada neste histórico.</p>}</section>
    <section className="billing-section billing-provider"><h2>Pagamento e faturas</h2><p className="ui-help">Disponibilidade do provedor comercial.</p><span className={`ui-status ${data.billingProvider.configured?'warn':''}`}><b>{data.billingProvider.configured?'Configuração detectada':'Provedor não configurado'}</b></span><p className="billing-provider-msg">{data.billingProvider.message}</p><p className="billing-pilot-notice" role="note">{PILOT_NOTICE}</p>{/* PAGAMENTO DESLIGADO NO PILOTO (decisão 2026-11-23): reativar quando houver gateway. Se `data.billingProvider.checkoutAvailable`/`portalAvailable` (vindos de /v1/billing/overview) algum dia forem true, a tela pode voltar a oferecer os botões abaixo (não implementado). <button disabled={!data.billingProvider.checkoutAvailable}>Alterar plano</button><button disabled={!data.billingProvider.portalAvailable}>Abrir portal de cobrança</button><small>Nenhuma cobrança é criada por esta tela enquanto o adapter estiver indisponível.</small> */}</section>
    <section className="billing-section billing-history"><h2>Histórico de assinaturas</h2><p className="ui-help">Registros persistidos para este workspace.</p>{data.history.subscriptions.length?<div className="ui-table-wrap"><table className="ui-table"><thead><tr><th>Plano</th><th>Status</th><th>Provedor</th><th>Período</th></tr></thead><tbody>{data.history.subscriptions.map(item=><tr key={item.id}><td>{label(PLAN_LABELS,item.plan)}</td><td>{label(SUBSCRIPTION_STATUS_LABELS,item.status)}</td><td>{label(PROVIDER_LABELS,item.provider)}</td><td>{date(item.currentPeriodStart)} — {date(item.currentPeriodEnd)}</td></tr>)}</tbody></table></div>:<p className="ui-empty">Nenhum histórico de assinatura persistido.</p>}</section>
  </div>
}
