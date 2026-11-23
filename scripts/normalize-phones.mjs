#!/usr/bin/env node
/**
 * Normaliza Contact.phone legado (sem '+', mascarado etc.) para o formato canônico E.164 com '+'
 * (packages/domain/src/phone.ts). Idempotente. NUNCA apaga nem funde contatos.
 *
 *   node scripts/normalize-phones.mjs            # --dry-run (padrão): só lista
 *   node scripts/normalize-phones.mjs --apply    # aplica SOMENTE as correções seguras
 *
 * Uso: DATABASE_URL=... node scripts/normalize-phones.mjs [--apply]
 * (Node < 22.18: acrescente --experimental-strip-types.)
 *
 * Classificação por contato:
 *  - ok         já canônico;
 *  - rename     canônico livre no workspace -> UPDATE phone (único tipo aplicado por --apply);
 *  - duplicate  outra linha do workspace já ocupa o canônico (ou duas linhas legadas mapeiam para ele)
 *               -> LISTADO, nunca alterado: a fusão toca conversas, execuções, kanban, broadcasts etc.
 *               e precisa de decisão humana (qual contato manter);
 *  - invalid    não normaliza (letras, tamanho inválido) -> LISTADO, nunca alterado.
 * O código da API já encontra linhas legadas e as "cura" ao tocá-las; este script só antecipa isso.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const apply = process.argv.includes('--apply');
if (apply && process.argv.includes('--dry-run')) { console.error('Use --dry-run OU --apply, não ambos.'); process.exit(2); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL ausente.'); process.exit(2); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { normalizePhone } = await import(path.join(root, 'packages/domain/src/phone.ts')).catch(error => {
  console.error('Não foi possível importar packages/domain/src/phone.ts (Node >= 22.18 ou --experimental-strip-types):', error.message); process.exit(2);
});
const { PrismaClient } = createRequire(path.join(root, 'apps/api/package.json'))('@prisma/client');
const prisma = new PrismaClient();

try {
  const contacts = await prisma.contact.findMany({ select: { id: true, workspaceId: true, phone: true, name: true, createdAt: true }, orderBy: [{ workspaceId: 'asc' }, { createdAt: 'asc' }] });
  const byWorkspace = new Map();
  for (const contact of contacts) {
    if (!byWorkspace.has(contact.workspaceId)) byWorkspace.set(contact.workspaceId, []);
    byWorkspace.get(contact.workspaceId).push(contact);
  }
  const renames = [], duplicates = [], invalid = [];
  let ok = 0;
  for (const [workspaceId, rows] of byWorkspace) {
    const occupied = new Set(rows.filter(row => row.phone === normalizePhone(row.phone)).map(row => row.phone));
    for (const row of rows) {
      const canonical = normalizePhone(row.phone);
      if (!canonical) { invalid.push(row); continue; }
      if (canonical === row.phone) { ok += 1; continue; }
      if (occupied.has(canonical)) { duplicates.push({ ...row, canonical }); continue; }
      occupied.add(canonical); // reserva: o primeiro legado (mais antigo) leva o canônico; o seguinte vira duplicata
      renames.push({ ...row, canonical });
    }
  }
  const show = (row, extra = '') => `  ws=${row.workspaceId} id=${row.id} phone=${JSON.stringify(row.phone)} ${extra}nome=${JSON.stringify(row.name ?? '')} criado=${row.createdAt.toISOString()}`;
  console.log(`Modo: ${apply ? 'APPLY' : 'DRY-RUN'} | contatos=${contacts.length} canônicos=${ok} renomeáveis=${renames.length} duplicados=${duplicates.length} inválidos=${invalid.length}`);
  if (renames.length) { console.log('\nRENOMEAR (seguro):'); renames.forEach(row => console.log(show(row, `-> ${row.canonical} `))); }
  if (duplicates.length) { console.log('\nDUPLICADOS (NÃO alterados; fundir manualmente):'); duplicates.forEach(row => console.log(show(row, `canônico ${row.canonical} já existe `))); }
  if (invalid.length) { console.log('\nINVÁLIDOS (NÃO alterados; corrigir manualmente):'); invalid.forEach(row => console.log(show(row))); }
  if (!apply) { console.log('\nDry-run: nada foi gravado. Rode com --apply para aplicar apenas os RENOMEAR.'); }
  else {
    let done = 0;
    for (const row of renames) {
      const result = await prisma.contact.updateMany({ where: { id: row.id, phone: row.phone }, data: { phone: row.canonical } }).catch(error => (error?.code === 'P2002' ? { count: 0 } : Promise.reject(error)));
      done += result.count;
    }
    console.log(`\nAplicado: ${done}/${renames.length} renomeados. Duplicados/inválidos permanecem para revisão.`);
  }
} finally { await prisma.$disconnect(); }
