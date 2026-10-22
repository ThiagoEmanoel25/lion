export type DelayMode='duration'|'date'|'schedule';
export type DelayUnit='seconds'|'minutes'|'hours'|'days';
export type ScheduleDay={day:number;enabled:boolean;start:string;end:string};
export type DelayConfig=
  |{mode:'duration';duration:number;unit:DelayUnit}
  |{mode:'date';runAt:string}
  |{mode:'schedule';timezone?:string;days:ScheduleDay[]};

const UNIT_SECONDS:Record<DelayUnit,number>={seconds:1,minutes:60,hours:3600,days:86400};
const MAX_DURATION_SECONDS=2_678_400;
const MAX_DATE_DAYS=365;
const DAY_MS=86_400_000;
const HHMM=/^([01]\d|2[0-3]):[0-5]\d$/;

/** Legacy `{seconds}` and `{duration,unit}` (no mode) become `duration`; anything else passes through for the schema to judge. */
export function normalizeDelayConfig(config:unknown):DelayConfig{
  if(!config||typeof config!=='object'||'mode' in config)return config as DelayConfig;
  const c=config as {seconds?:unknown;duration?:unknown;unit?:unknown};
  if('seconds' in c)return {mode:'duration',duration:c.seconds,unit:'seconds'} as DelayConfig; // legacy `seconds` is the canonical total; `unit` was only a display hint
  if('duration' in c)return {mode:'duration',duration:c.duration,unit:c.unit??'seconds'} as DelayConfig;
  return config as DelayConfig;
}

/** First problem with the config as a pt-BR message, or null. Pure apart from the injected clock. */
export function delayConfigIssue(config:DelayConfig,now=new Date()):string|null{
  if(config.mode==='duration'){
    const seconds=config.duration*(UNIT_SECONDS[config.unit]??NaN);
    if(!Number.isInteger(config.duration)||!(seconds>=1&&seconds<=MAX_DURATION_SECONDS))return 'A espera deve ter entre 1 segundo e 31 dias.';
    return null;
  }
  if(config.mode==='date'){
    const at=Date.parse(config.runAt);
    if(Number.isNaN(at)||!/(Z|[+-]\d\d:?\d\d)$/i.test(config.runAt))return 'Informe a data em ISO 8601 com fuso.';
    return at>now.getTime()+MAX_DATE_DAYS*DAY_MS?'A data deve estar a no máximo 365 dias.':null;
  }
  if(!config.days.some(d=>d.enabled))return 'Ative ao menos um dia.';
  for(const d of config.days){
    if(!d.enabled)continue;
    if(!HHMM.test(d.start)||!HHMM.test(d.end))return 'Use horários no formato HH:mm.';
    if(d.start>=d.end)return d.start>d.end?'Faixa que atravessa a meia-noite ainda não é suportada.':'O início deve ser antes do fim.';
  }
  return null;
}

function parts(ms:number,timeZone:string){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(ms).map(x=>[x.type,x.value]));
  return {y:+p.year!,m:+p.month!,d:+p.day!,h:+p.hour!,min:+p.minute!,s:+p.second!};
}
const offsetMs=(ms:number,tz:string)=>{const p=parts(ms,tz);return Date.UTC(p.y,p.m-1,p.d,p.h,p.min,p.s)-Math.floor(ms/1000)*1000};
/** Local wall time in `tz` to a UTC instant; second pass settles offsets across a DST change. */
function localToUtc(y:number,m:number,d:number,hhmm:string,tz:string){
  const wall=Date.UTC(y,m-1,d,+hhmm.slice(0,2),+hhmm.slice(3));
  const first=wall-offsetMs(wall,tz);
  return wall-offsetMs(first,tz);
}

export function nextDelayAt(config:DelayConfig,now:Date,workspaceTimezone:string):{at:Date;mode:DelayMode}{
  const issue=delayConfigIssue(config,now);
  if(issue)throw new Error(issue);
  if(config.mode==='duration')return {at:new Date(now.getTime()+config.duration*UNIT_SECONDS[config.unit]*1000),mode:'duration'};
  if(config.mode==='date')return {at:new Date(Math.max(Date.parse(config.runAt),now.getTime())),mode:'date'};
  const tz=config.timezone||workspaceTimezone;
  const today=parts(now.getTime(),tz);
  const weekday=new Date(Date.UTC(today.y,today.m-1,today.d)).getUTCDay();
  for(let i=0;i<=7;i++){
    const rule=config.days.find(d=>d.day===(weekday+i)%7&&d.enabled);
    if(!rule)continue;
    const date=new Date(Date.UTC(today.y,today.m-1,today.d+i));
    const [y,m,d]=[date.getUTCFullYear(),date.getUTCMonth()+1,date.getUTCDate()];
    const start=localToUtc(y,m,d,rule.start,tz),end=localToUtc(y,m,d,rule.end,tz);
    if(now.getTime()>=end)continue;
    return {at:new Date(Math.max(start,now.getTime())),mode:'schedule'};
  }
  throw new Error('Nenhum horário ativo nos próximos 8 dias.');
}
