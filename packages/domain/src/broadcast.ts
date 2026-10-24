// Disparo em massa. O WhatsApp não oficial bane número que envia em rajada, então a agenda é o
// coração da função: intervalo aleatório entre envios e um teto por dia, por canal.
export type BroadcastPacing = {
  startAt: Date;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  dailyQuota: number;
};

export const BROADCAST_LIMITS = {
  minIntervalSeconds: 20,
  maxIntervalSeconds: 3_600,
  minDailyQuota: 1,
  maxDailyQuota: 1_000,
  maxRecipients: 5_000
} as const;

export function broadcastPacingIssue(pacing: Omit<BroadcastPacing, 'startAt'>): string | null {
  const { minIntervalSeconds: min, maxIntervalSeconds: max, dailyQuota } = pacing;
  if (!Number.isInteger(min) || !Number.isInteger(max) || !Number.isInteger(dailyQuota)) return 'Use números inteiros no intervalo e na cota.';
  if (min < BROADCAST_LIMITS.minIntervalSeconds) return `O intervalo mínimo é de ${BROADCAST_LIMITS.minIntervalSeconds} segundos entre envios, para o número não ser bloqueado.`;
  if (max > BROADCAST_LIMITS.maxIntervalSeconds) return 'O intervalo máximo é de 1 hora entre envios.';
  if (min > max) return 'O intervalo mínimo não pode passar do máximo.';
  if (dailyQuota < BROADCAST_LIMITS.minDailyQuota || dailyQuota > BROADCAST_LIMITS.maxDailyQuota) return `A cota diária vai de ${BROADCAST_LIMITS.minDailyQuota} a ${BROADCAST_LIMITS.maxDailyQuota} envios.`;
  return null;
}

const DAY_MS = 86_400_000;

// Devolve o horário de cada envio, em ordem. Cada passo soma um intervalo sorteado entre o mínimo e
// o máximo; ao bater a cota do dia, o resto vai para o mesmo horário do dia seguinte. A cota conta
// por janela de 24 h a partir do início, não por data no calendário: é o que protege o número.
export function planBroadcastSchedule(total: number, pacing: BroadcastPacing, random: () => number = Math.random): Date[] {
  if (!Number.isInteger(total) || total <= 0) return [];
  const span = pacing.maxIntervalSeconds - pacing.minIntervalSeconds;
  const schedule: Date[] = [];
  let cursor = pacing.startAt.getTime();
  let dayStart = cursor;
  let sentInDay = 0;
  for (let index = 0; index < Math.min(total, BROADCAST_LIMITS.maxRecipients); index++) {
    if (sentInDay >= pacing.dailyQuota) {
      dayStart += DAY_MS;
      cursor = Math.max(cursor, dayStart);
      sentInDay = 0;
    }
    schedule.push(new Date(cursor));
    sentInDay++;
    const jitter = Math.floor(Math.min(Math.max(random(), 0), 1 - Number.EPSILON) * (span + 1));
    cursor += (pacing.minIntervalSeconds + jitter) * 1_000;
  }
  return schedule;
}

// Palavras que, recebidas do contato, tiram ele da lista. Comparadas com a mensagem inteira, não
// como pedaço: "pare de me mandar" sai, mas "não pare de mandar novidades" não deve sair por engano.
const OPT_OUT_WORDS = ['sair', 'parar', 'pare', 'stop', 'cancelar', 'descadastrar', 'remover', 'nao quero', 'não quero'];

export function isOptOutMessage(body: string | null | undefined): boolean {
  if (!body) return false;
  const normalized = body.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.split(' ').length > 4) return false;
  return OPT_OUT_WORDS.some(word => normalized === word.normalize('NFD').replace(/[̀-ͯ]/g, ''));
}
