// Rótulos em pt-BR para valores crus da API. Valores desconhecidos voltam como vieram.
export const stages:Array<[string,string]>=[['new','Novos leads'],['qualification','Em qualificação'],['scheduled','Agendados'],['customer','Clientes']];
export const stageLabel=(value:string|null|undefined)=>{if(!value)return '—';return stages.find(([id])=>id===value)?.[1]??value};
const sources:Record<string,string>={website:'Site',site:'Site',referral:'Indicação',instagram:'Instagram',facebook:'Facebook',whatsapp:'WhatsApp',google:'Google',manual:'Cadastro manual',import:'Importação',csv:'Importação CSV',api:'API',event:'Evento',email:'E-mail',phone:'Telefone',ads:'Anúncio',organic:'Orgânico'};
export const sourceLabel=(value:string|null|undefined)=>{if(!value)return '—';return sources[value.trim().toLowerCase()]??value};
/** Telefone sempre com '+' (a API grava E.164). Não normaliza nada além de prefixar números puros. */
export function formatPhone(phone:string|null|undefined){if(!phone)return '';const value=phone.trim();return /^\d{8,}$/.test(value)?`+${value}`:value}
