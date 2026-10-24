// Leitura estruturada do comprovante. A IA devolve texto livre, então nada aqui confia no formato:
// um campo que não dá para interpretar vira null, e o fluxo decide o que fazer com isso.
// As chaves são as mesmas que os funis importados do Leona já usam ({{comprovante.valor}}).
export type Receipt = { valor: number | null; nome_pagador: string | null; data: string | null; referencia: string | null };

export const EMPTY_RECEIPT: Receipt = { valor: null, nome_pagador: null, data: null, referencia: null };

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed && trimmed.toLowerCase() !== 'null' ? trimmed.slice(0, max) : null;
};

// "R$ 1.234,56", "1,234.56", "1234,5" e "1234.56" são todos o mesmo valor em comprovantes reais.
// O último separador manda: se tem 1 ou 2 dígitos depois dele, é decimal; senão é milhar.
export function parseReceiptAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\s ]/g, '').replace(/^(r\$|rs|brl)/i, '');
  if (!/^-?\d[\d.,]*$/.test(cleaned)) return null;
  const lastSeparator = Math.max(cleaned.lastIndexOf(','), cleaned.lastIndexOf('.'));
  const decimals = lastSeparator === -1 ? 0 : cleaned.length - lastSeparator - 1;
  const digits = cleaned.replace(/[.,]/g, '');
  if (!/^-?\d+$/.test(digits)) return null;
  const amount = decimals >= 1 && decimals <= 2 ? Number(digits) / 10 ** decimals : Number(digits);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : null;
}

// Sempre devolve yyyy-mm-dd, porque é o formato que ordena e compara. Data impossível vira null.
export function parseReceiptDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw) ?? null;
  const parts = match ? [Number(match[1]), Number(match[2]), Number(match[3])] as const : (() => {
    const br = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
    return br ? [Number(br[3]), Number(br[2]), Number(br[1])] as const : null;
  })();
  if (!parts) return null;
  const [year, month, day] = parts;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejeita 31/02: o Date rola para o mês seguinte em vez de recusar.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseReceipt(raw: unknown): Receipt {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY_RECEIPT };
  const source = raw as Record<string, unknown>;
  return {
    valor: parseReceiptAmount(source.valor ?? source.amount ?? source.value),
    nome_pagador: text(source.nome_pagador ?? source.nomePagador ?? source.payer, 200),
    data: parseReceiptDate(source.data ?? source.date),
    referencia: text(source.referencia ?? source.reference ?? source.id, 120)
  };
}
