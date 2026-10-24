import { describe, expect, it } from 'vitest';
import { parseReceipt, parseReceiptAmount, parseReceiptDate } from './receipt.js';

describe('parseReceiptAmount', () => {
  it('lê o formato brasileiro com milhar e centavos', () => { expect(parseReceiptAmount('R$ 1.234,56')).toBe(1234.56); });
  it('lê o formato americano', () => { expect(parseReceiptAmount('1,234.56')).toBe(1234.56); });
  it('lê um centavo só', () => { expect(parseReceiptAmount('1234,5')).toBe(1234.5); });
  it('trata separador de milhar sem centavos como milhar, não como decimal', () => {
    expect(parseReceiptAmount('1.234')).toBe(1234);
    expect(parseReceiptAmount('1,234')).toBe(1234);
  });
  it('aceita número puro', () => { expect(parseReceiptAmount(99.9)).toBe(99.9); });
  it('arredonda para centavos em vez de deixar dízima', () => { expect(parseReceiptAmount(10.005)).toBe(10.01); });
  it('aceita espaço não separável, que vem de PDF', () => { expect(parseReceiptAmount('R$ 250,00')).toBe(250); });
  it('recusa o que não é valor', () => {
    for (const value of ['', 'não informado', 'null', 'R$', '12,34,56.78abc', {}, null, undefined, NaN, -5, Infinity]) expect(parseReceiptAmount(value)).toBeNull();
  });
});

describe('parseReceiptDate', () => {
  it('normaliza dd/mm/aaaa para ISO', () => { expect(parseReceiptDate('05/10/2026')).toBe('2026-10-05'); });
  it('aceita ISO e descarta a hora', () => { expect(parseReceiptDate('2026-10-05T14:33:00Z')).toBe('2026-10-05'); });
  it('aceita dia e mês sem zero à esquerda', () => { expect(parseReceiptDate('5/3/2026')).toBe('2026-03-05'); });
  it('recusa uma data que não existe em vez de rolar para o mês seguinte', () => { expect(parseReceiptDate('31/02/2026')).toBeNull(); });
  it('recusa lixo e ano implausível', () => {
    for (const value of ['', 'ontem', '13/13/2026', '05/10/26', '1999-01-01', 42, null]) expect(parseReceiptDate(value)).toBeNull();
  });
});

describe('parseReceipt', () => {
  it('lê um comprovante completo', () => {
    expect(parseReceipt({ valor: 'R$ 150,00', nome_pagador: '  Maria  Silva ', data: '05/10/2026', referencia: 'E12345' }))
      .toEqual({ valor: 150, nome_pagador: 'Maria Silva', data: '2026-10-05', referencia: 'E12345' });
  });
  it('aceita os nomes em inglês que a IA às vezes devolve', () => {
    expect(parseReceipt({ amount: 10, payer: 'João', date: '2026-10-05', reference: 'X1' }))
      .toEqual({ valor: 10, nome_pagador: 'João', data: '2026-10-05', referencia: 'X1' });
  });
  it('devolve tudo nulo em vez de quebrar quando a IA não manda objeto', () => {
    for (const value of [null, undefined, 'texto', [], 42]) expect(parseReceipt(value)).toEqual({ valor: null, nome_pagador: null, data: null, referencia: null });
  });
  it('mantém nulo o campo que a IA não conseguiu ler', () => {
    expect(parseReceipt({ valor: 'ilegível', nome_pagador: 'null', data: '', referencia: 'OK' }))
      .toEqual({ valor: null, nome_pagador: null, data: null, referencia: 'OK' });
  });
});
