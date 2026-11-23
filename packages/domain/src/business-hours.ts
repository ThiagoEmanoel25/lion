export type BusinessHoursDay = { day: number; enabled: boolean; open: string; close: string };
export type BusinessHoursConfig = { days: BusinessHoursDay[] };

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const toMinutes = (value: string): number | null => {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/** Dia da semana (0=domingo) e minuto do dia de `date` no fuso informado, ou null se o fuso é inválido. */
function localClock(date: Date, timezone: string): { day: number; minute: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
    const day = WEEKDAYS[get('weekday')];
    if (day === undefined) return null;
    return { day, minute: Number(get('hour')) * 60 + Number(get('minute')) };
  } catch {
    return null;
  }
}

/**
 * Diz se `date` cai dentro do expediente configurado, avaliado no fuso `timezone` (IANA; o horário de verão
 * vem do próprio fuso). Abertura inclusive, fechamento exclusivo. Faixa com fechamento anterior à abertura
 * cruza a meia-noite: a parte após 00:00 pertence ao dia seguinte. Dia desligado ou faixa vazia (abre = fecha)
 * fica fechado. Configuração ou fuso inválidos retornam true (na dúvida, trata como aberto: nunca incomoda o cliente).
 */
export function isWithinBusinessHours(config: BusinessHoursConfig | null | undefined, date: Date, timezone: string): boolean {
  if (!config || !Array.isArray(config.days) || Number.isNaN(date.getTime())) return true;
  const clock = localClock(date, timezone);
  if (!clock) return true;
  const previous = (clock.day + 6) % 7;
  for (const entry of config.days) {
    if (!entry || !entry.enabled) continue;
    const open = toMinutes(entry.open), close = toMinutes(entry.close);
    if (open === null || close === null || open === close) continue;
    if (open < close) {
      if (entry.day === clock.day && clock.minute >= open && clock.minute < close) return true;
    } else if ((entry.day === clock.day && clock.minute >= open) || (entry.day === previous && clock.minute < close)) return true;
  }
  return false;
}
