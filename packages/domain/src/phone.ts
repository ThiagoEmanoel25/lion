/**
 * Telefone canônico: E.164 com '+' (ex.: +5571999124830). Fonte única para API e runtime.
 *
 * Regras:
 *  - letras ou qualquer caractere fora de dígitos, espaço, ( ) - . / + => null;
 *  - '+' só é aceito no início; prefixo '00' equivale a '+';
 *  - com '+' ou '00' o número já traz DDI: vale 8 a 15 dígitos (limite E.164);
 *  - sem '+'/'00': 10 ou 11 dígitos são números brasileiros sem DDI (DDD + número) e ganham +55;
 *    12 a 15 dígitos são tratados como já contendo DDI; qualquer outro comprimento => null.
 */
export function normalizePhone(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text || !/^[+\d\s().\-/]+$/.test(text)) return null;
  if (text.lastIndexOf('+') > 0) return null;
  let digits = text.replace(/\D/g, '');
  let hasCountryCode = text.startsWith('+');
  if (!hasCountryCode && digits.startsWith('00')) { digits = digits.slice(2); hasCountryCode = true; }
  if (!digits || digits.startsWith('0')) return null;
  if (hasCountryCode) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if (digits.length >= 12 && digits.length <= 15) return `+${digits}`;
  return null;
}
