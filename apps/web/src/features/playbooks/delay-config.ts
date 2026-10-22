// Mirrors packages/domain/src/delay.ts (the web package never imports values from shared packages).
export type DelayUnit = 'seconds' | 'minutes' | 'hours' | 'days';
export type DelayDay = { day: number; enabled: boolean; start: string; end: string };
export type DelayCfg =
  | { mode: 'duration'; duration: number; unit: DelayUnit }
  | { mode: 'date'; runAt: string }
  | { mode: 'schedule'; timezone?: string; days: DelayDay[] };

export const DELAY_UNIT_SECONDS: Record<DelayUnit, number> = { seconds: 1, minutes: 60, hours: 3600, days: 86400 };
export const DELAY_UNIT_LABELS: Record<DelayUnit, [string, string]> = { seconds: ['segundo', 'segundos'], minutes: ['minuto', 'minutos'], hours: ['hora', 'horas'], days: ['dia', 'dias'] };
export const DELAY_MAX_SECONDS = 2_678_400;
export const DELAY_MAX_DATE_DAYS = 365;
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const DISPLAY_DAY_ORDER = ORDER;

export const defaultScheduleDays = (): DelayDay[] => [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, enabled: day >= 1 && day <= 5, start: '09:00', end: '18:00' }));

/** Largest unit that divides the total evenly: 172800 s opens as "2 dias", never "172800 segundos". */
export function bestUnit(seconds: number): { duration: number; unit: DelayUnit } {
  for (const unit of ['days', 'hours', 'minutes'] as const) if (seconds >= DELAY_UNIT_SECONDS[unit] && seconds % DELAY_UNIT_SECONDS[unit] === 0) return { duration: seconds / DELAY_UNIT_SECONDS[unit], unit };
  return { duration: seconds, unit: 'seconds' };
}

/** Reads any stored delay config (legacy or new) into the editor's shape. */
export function delayConfigOf(config: Record<string, unknown>): DelayCfg {
  if (config.mode === 'date' && typeof config.runAt === 'string') return { mode: 'date', runAt: config.runAt };
  if (config.mode === 'schedule' && Array.isArray(config.days)) return { mode: 'schedule', ...(typeof config.timezone === 'string' ? { timezone: config.timezone } : {}), days: config.days as DelayDay[] };
  const unit = String(config.unit) in DELAY_UNIT_SECONDS ? config.unit as DelayUnit : 'seconds';
  const seconds = config.mode === 'duration' ? Number(config.duration) * DELAY_UNIT_SECONDS[unit] : 'seconds' in config ? Number(config.seconds) : 'duration' in config ? Number(config.duration) * DELAY_UNIT_SECONDS[unit] : 300;
  return { mode: 'duration', ...bestUnit(Number.isFinite(seconds) && seconds >= 1 ? Math.round(seconds) : 300) };
}

function wall(ms: number, timeZone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ms).map(x => [x.type, x.value]));
  return { y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour!, min: +p.minute! };
}
const offsetMin = (ms: number, tz: string) => { const p = wall(ms, tz); return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(ms / 60000) * 60000) / 60000); };
const pad = (n: number) => String(n).padStart(2, '0');

/** `datetime-local` value read as wall time in `tz`, as ISO 8601 with offset. */
export function localToIso(local: string, tz: string): string {
  const [y, m, d, h, min] = local.split(/[-T:]/).map(Number) as [number, number, number, number, number];
  const base = Date.UTC(y, m - 1, d, h, min);
  let off = offsetMin(base, tz); off = offsetMin(base - off * 60000, tz);
  return `${local}:00${off < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}
/** ISO instant to a `datetime-local` value in `tz`. */
export function isoToLocal(iso: string, tz: string): string {
  const ms = Date.parse(iso); if (Number.isNaN(ms)) return '';
  const p = wall(ms, tz); return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}`;
}

/** First problem as a pt-BR message, or ''. */
export function delayCfgError(cfg: DelayCfg, now = Date.now()): string {
  if (cfg.mode === 'duration') { const s = cfg.duration * DELAY_UNIT_SECONDS[cfg.unit]; return !Number.isInteger(cfg.duration) || !(s >= 1 && s <= DELAY_MAX_SECONDS) ? 'A espera deve ter entre 1 segundo e 31 dias.' : ''; }
  if (cfg.mode === 'date') { const at = Date.parse(cfg.runAt); return Number.isNaN(at) ? 'Informe a data e a hora.' : at > now + DELAY_MAX_DATE_DAYS * 86_400_000 ? 'A data deve estar a no máximo 365 dias.' : ''; }
  if (!cfg.days.some(d => d.enabled)) return 'Ative ao menos um dia da semana';
  for (const d of cfg.days) if (d.enabled && d.start >= d.end) return `${DAY_NAMES[d.day]}: o início deve ser antes do fim.`;
  return '';
}

/** Canvas preview: "Espera de 5 minutos", "Até 25/10 14:00" or "Seg–Sex 09:00–18:00". */
export function delaySummary(config: Record<string, unknown>): string {
  const cfg = delayConfigOf(config);
  if (cfg.mode === 'duration') { const [one, many] = DELAY_UNIT_LABELS[cfg.unit]; return `Espera de ${cfg.duration} ${cfg.duration === 1 ? one : many}`; }
  if (cfg.mode === 'date') { const m = /^\d{4}-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(cfg.runAt); return m ? `Até ${m[2]}/${m[1]} ${m[3]}:${m[4]}` : 'Data não definida'; }
  const byDay = new Map(cfg.days.filter(d => d.enabled).map(d => [d.day, `${d.start}–${d.end}`]));
  const groups: string[] = [];
  for (let i = 0; i < ORDER.length; i++) {
    const range = byDay.get(ORDER[i]!); if (!range) continue;
    let j = i; while (j + 1 < ORDER.length && byDay.get(ORDER[j + 1]!) === range) j++;
    groups.push(`${DAY_SHORT[ORDER[i]!]}${j > i ? `–${DAY_SHORT[ORDER[j]!]}` : ''} ${range}`); i = j;
  }
  return groups.join(' · ') || 'Nenhum dia ativo';
}
