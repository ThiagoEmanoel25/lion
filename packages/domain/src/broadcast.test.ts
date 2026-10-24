import { describe, expect, it } from 'vitest';
import { BROADCAST_LIMITS, broadcastPacingIssue, isOptOutMessage, planBroadcastSchedule } from './broadcast.js';

const startAt = new Date('2026-10-24T12:00:00Z');
const pacing = { startAt, minIntervalSeconds: 60, maxIntervalSeconds: 60, dailyQuota: 100 };
// random fixo em 0 deixa o intervalo no mínimo, o que torna a agenda previsível no teste.
const fixed = (value: number) => () => value;

describe('planBroadcastSchedule', () => {
  it('o primeiro envio sai no horário de início', () => {
    expect(planBroadcastSchedule(1, pacing, fixed(0))[0]).toEqual(startAt);
  });

  it('espaça os envios pelo intervalo sorteado', () => {
    const schedule = planBroadcastSchedule(3, pacing, fixed(0));
    expect(schedule.map(date => date.toISOString())).toEqual(['2026-10-24T12:00:00.000Z', '2026-10-24T12:01:00.000Z', '2026-10-24T12:02:00.000Z']);
  });

  it('sorteia dentro da faixa, sem nunca ficar abaixo do mínimo', () => {
    const wide = { ...pacing, minIntervalSeconds: 30, maxIntervalSeconds: 90 };
    for (const value of [0, 0.5, 0.999999]) {
      const [first, second] = planBroadcastSchedule(2, wide, fixed(value));
      const gap = (second!.getTime() - first!.getTime()) / 1000;
      expect(gap).toBeGreaterThanOrEqual(30);
      expect(gap).toBeLessThanOrEqual(90);
    }
  });

  it('empurra o excedente da cota para o dia seguinte', () => {
    const schedule = planBroadcastSchedule(5, { ...pacing, dailyQuota: 2 }, fixed(0));
    expect(schedule.map(date => date.toISOString())).toEqual([
      '2026-10-24T12:00:00.000Z', '2026-10-24T12:01:00.000Z',
      '2026-10-25T12:00:00.000Z', '2026-10-25T12:01:00.000Z',
      '2026-10-26T12:00:00.000Z'
    ]);
  });

  it('não puxa o envio para trás quando o intervalo já passou do dia seguinte', () => {
    // Intervalo de 23 h com cota 2: o segundo envio cai no dia seguinte, e a virada da cota não
    // pode trazer o terceiro de volta para o horário de início daquele dia.
    // Intervalo de 23 h com cota 2 faz a cota do dia acabar depois do dia seguinte começar. Se a
    // virada puxasse o cursor de volta, dois envios sairiam a 1 h de distância, abaixo do mínimo.
    const schedule = planBroadcastSchedule(3, { ...pacing, minIntervalSeconds: 82_800, maxIntervalSeconds: 82_800, dailyQuota: 2 }, fixed(0));
    for (let index = 1; index < schedule.length; index++) {
      expect((schedule[index]!.getTime() - schedule[index - 1]!.getTime()) / 1000).toBeGreaterThanOrEqual(82_800);
    }
  });

  it('nunca agenda para trás ao virar o dia', () => {
    const schedule = planBroadcastSchedule(4, { ...pacing, minIntervalSeconds: 3_600, maxIntervalSeconds: 3_600, dailyQuota: 2 }, fixed(0));
    for (let index = 1; index < schedule.length; index++) expect(schedule[index]!.getTime()).toBeGreaterThan(schedule[index - 1]!.getTime());
  });

  it('respeita o teto de destinatários em vez de gerar uma agenda infinita', () => {
    expect(planBroadcastSchedule(99_999, pacing, fixed(0))).toHaveLength(BROADCAST_LIMITS.maxRecipients);
  });

  it('devolve vazio para total inválido', () => {
    for (const total of [0, -1, 1.5, Number.NaN]) expect(planBroadcastSchedule(total, pacing, fixed(0))).toEqual([]);
  });
});

describe('broadcastPacingIssue', () => {
  it('aceita uma configuração segura', () => {
    expect(broadcastPacingIssue({ minIntervalSeconds: 30, maxIntervalSeconds: 120, dailyQuota: 200 })).toBeNull();
  });
  it('recusa rajada abaixo do intervalo mínimo', () => {
    expect(broadcastPacingIssue({ minIntervalSeconds: 1, maxIntervalSeconds: 120, dailyQuota: 200 })).toMatch(/intervalo mínimo/);
  });
  it('recusa mínimo maior que o máximo, cota fora da faixa e número quebrado', () => {
    expect(broadcastPacingIssue({ minIntervalSeconds: 120, maxIntervalSeconds: 60, dailyQuota: 10 })).toMatch(/não pode passar/);
    expect(broadcastPacingIssue({ minIntervalSeconds: 30, maxIntervalSeconds: 60, dailyQuota: 0 })).toMatch(/cota diária/);
    expect(broadcastPacingIssue({ minIntervalSeconds: 30, maxIntervalSeconds: 60, dailyQuota: 5_000 })).toMatch(/cota diária/);
    expect(broadcastPacingIssue({ minIntervalSeconds: 30.5, maxIntervalSeconds: 60, dailyQuota: 10 })).toMatch(/inteiros/);
  });
});

describe('isOptOutMessage', () => {
  it('reconhece os pedidos de saída, com e sem acento', () => {
    for (const body of ['sair', 'SAIR', 'Parar', 'pare', 'stop', 'cancelar', 'descadastrar', 'remover', 'não quero', 'nao quero', '  sair!  ']) expect(isOptOutMessage(body)).toBe(true);
  });
  it('não tira da lista quem só usou a palavra dentro de uma frase', () => {
    for (const body of ['não pare de mandar novidades por favor', 'quero sair daqui às cinco da tarde amanhã', 'pode cancelar meu pedido de ontem por favor']) expect(isOptOutMessage(body)).toBe(false);
  });
  it('ignora vazio e mensagem sem letra', () => {
    for (const body of ['', '   ', null, undefined, '👍', '123']) expect(isOptOutMessage(body)).toBe(false);
  });
});
