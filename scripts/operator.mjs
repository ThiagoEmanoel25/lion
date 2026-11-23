#!/usr/bin/env node
/**
 * Ferramenta do OPERADOR da plataforma (quem administra o servidor): onboarding por convite, sem signup aberto.
 * Os links são impressos UMA vez e entregues manualmente ao cliente. No banco só ficam os hashes SHA-256.
 *
 *   node scripts/operator.mjs [--env-file .env] <comando> [opções]
 *
 *   create-workspace --name "Clínica X" --slug clinica-x --owner-email dono@x.com [--owner-name "Fulano"] [--invite-days 7] [--dry-run]
 *   reset-password   --email x@y.com [--hours 2] [--dry-run]
 *   reissue-invite   --workspace-slug clinica-x --email dono@x.com [--invite-days 7] [--dry-run]
 *   list
 *   --help
 *
 * URL base dos links: PUBLIC_WEB_URL, senão WEB_ORIGIN (primeira origem). DATABASE_URL vem do ambiente ou de --env-file.
 */
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HELP = `Uso: node scripts/operator.mjs [--env-file .env] <comando> [opções]

Comandos:
  create-workspace --name "Clínica X" --slug clinica-x --owner-email dono@x.com [--owner-name "Fulano"] [--invite-days 7] [--dry-run]
      Cria o workspace (plano free, provider local) e um convite OWNER; imprime o link /convite/<token> uma única vez.
  reset-password --email x@y.com [--hours 2] [--dry-run]
      Gera link /redefinir-senha/<token> (invalida os anteriores não usados).
  reissue-invite --workspace-slug clinica-x --email dono@x.com [--invite-days 7] [--dry-run]
      Novo link para convite de dono ainda não aceito (revoga o anterior).
  list
      Workspaces com dono, status do convite e nº de membros.

Opções globais: --env-file <arquivo> (DATABASE_URL, PUBLIC_WEB_URL/WEB_ORIGIN), --dry-run, --help.
Os tokens nunca são gravados em claro (só SHA-256) e só aparecem na saída deste comando.`;

const argv = process.argv.slice(2);
const flags = {}; const rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--help' || a === '-h') flags.help = true;
  else if (a === '--dry-run') flags.dryRun = true;
  else if (a.startsWith('--')) { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) fail(`Falta valor para ${a}.`); flags[a.slice(2)] = v; i++; }
  else rest.push(a);
}
function fail(msg, code = 2) { console.error(`Erro: ${msg}`); process.exit(code); }
const command = rest[0];
if (flags.help || !command) { console.log(HELP); process.exit(flags.help ? 0 : 2); }
if (!['create-workspace', 'reset-password', 'reissue-invite', 'list'].includes(command)) fail(`Comando desconhecido: ${command}. Use --help.`);

if (flags['env-file']) {
  let text; try { text = readFileSync(flags['env-file'], 'utf8'); } catch { fail('Não foi possível ler o arquivo de env informado.'); }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (!m || line.trim().startsWith('#')) continue;
    let v = m[2]; if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
if (!process.env.DATABASE_URL) fail('DATABASE_URL ausente (ambiente ou --env-file).');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { PrismaClient } = createRequire(path.join(root, 'apps/api/package.json'))('@prisma/client');
const prisma = new PrismaClient();

const sha256 = t => createHash('sha256').update(t).digest('hex');
const newToken = () => { const token = randomBytes(32).toString('base64url'); return { token, hash: sha256(token) }; };
const baseUrl = () => {
  const raw = (process.env.PUBLIC_WEB_URL || (process.env.WEB_ORIGIN || '').split(',')[0] || '').trim().replace(/\/+$/, '');
  if (!raw) fail('Defina PUBLIC_WEB_URL ou WEB_ORIGIN (ambiente ou --env-file) para montar o link.');
  return raw;
};
const num = (name, fallback, max) => { if (flags[name] === undefined) return fallback; const n = Number(flags[name]); if (!Number.isFinite(n) || n <= 0 || n > max) fail(`--${name} inválido (0 < valor <= ${max}).`); return n; };
const need = name => { const v = flags[name]?.trim(); if (!v) fail(`Falta --${name}. Use --help.`); return v; };
const emailOf = name => { const v = need(name).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail(`--${name} não é um e-mail válido.`); return v; };
const dry = Boolean(flags.dryRun);
const FREE_LIMITS = { contacts: 250, members: 2, channels: 1, executionsMonthly: 500 }; // = planDefaults.free (billing/service.ts)

const logDry = msg => console.log(`[dry-run] ${msg}`);
const refuse = msg => { console.error(`Recusado: ${msg}`); process.exitCode = 1; };

async function createWorkspace() {
  const name = need('name'); const slug = need('slug').toLowerCase(); const email = emailOf('owner-email');
  if (name.length < 2 || name.length > 100) fail('--name deve ter 2 a 100 caracteres.');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug)) fail('--slug deve ser minúsculo (a-z, 0-9, hífen), até 64 caracteres.');
  const ownerName = flags['owner-name']?.trim() || null; const days = num('invite-days', 7, 90);
  const url = baseUrl();
  if (await prisma.workspace.findUnique({ where: { slug } })) return refuse(`o slug "${slug}" já existe.`);
  if (await prisma.user.findUnique({ where: { email } })) return refuse('o e-mail do dono já possui conta (um e-mail = um workspace).');
  const pending = await prisma.workspaceInvite.findFirst({ where: { email, status: 'PENDING', expiresAt: { gt: new Date() } }, include: { workspace: { select: { slug: true } } } });
  if (pending) return refuse(`o e-mail do dono já tem convite pendente no workspace "${pending.workspace.slug}".`);
  const { token, hash } = newToken(); const expiresAt = new Date(Date.now() + days * 864e5);
  if (dry) { logDry(`criaria workspace "${name}" (${slug}), assinatura free/local, convite OWNER para ${email} válido até ${expiresAt.toISOString()}. Nada gravado.`); return; }
  const now = new Date();
  const ws = await prisma.$transaction(async tx => {
    const workspace = await tx.workspace.create({ data: { name, slug } });
    await tx.subscription.create({ data: { workspaceId: workspace.id, provider: 'local', plan: 'free', status: 'active', limits: FREE_LIMITS, currentPeriodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), currentPeriodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) } });
    const invite = await tx.workspaceInvite.create({ data: { workspaceId: workspace.id, email, name: ownerName, role: 'OWNER', tokenHash: hash, expiresAt, createdById: 'operator' } });
    await tx.auditLog.create({ data: { workspaceId: workspace.id, action: 'operator.workspace_created', targetType: 'Workspace', targetId: workspace.id, changes: { slug, ownerEmail: email, inviteId: invite.id, inviteDays: days, plan: 'free' } } });
    return workspace;
  });
  console.log(`Workspace criado: ${ws.name} (${ws.slug})`);
  console.log(`Convite OWNER para ${email}, válido até ${expiresAt.toISOString()}.`);
  console.log('Link (exibido uma única vez; entregue ao cliente):');
  console.log(`${url}/convite/${token}`);
}

async function resetPassword() {
  const email = emailOf('email'); const hours = num('hours', 2, 72); const url = baseUrl();
  const user = await prisma.user.findUnique({ where: { email }, include: { memberships: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 1 } } });
  if (!user || !user.isActive) return refuse('usuário inexistente ou inativo.');
  const workspaceId = user.memberships[0]?.workspaceId;
  if (!workspaceId) return refuse('usuário sem workspace.');
  const expiresAt = new Date(Date.now() + hours * 36e5);
  if (dry) { logDry(`geraria link de redefinição para ${email} válido por ${hours}h e invalidaria tokens anteriores não usados. Nada gravado.`); return; }
  const { token, hash } = newToken();
  const invalidated = await prisma.$transaction(async tx => {
    const old = await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash: hash, expiresAt, createdById: 'operator' } });
    await tx.auditLog.create({ data: { workspaceId, action: 'operator.password_reset_issued', targetType: 'User', targetId: user.id, changes: { hours, invalidatedPrevious: old.count } } });
    return old.count;
  });
  console.log(`Redefinição emitida para ${email}, válida até ${expiresAt.toISOString()} (${invalidated} token(s) anterior(es) invalidado(s)).`);
  console.log('Link (exibido uma única vez):');
  console.log(`${url}/redefinir-senha/${token}`);
}

async function reissueInvite() {
  const slug = need('workspace-slug').toLowerCase(); const email = emailOf('email'); const days = num('invite-days', 7, 90); const url = baseUrl();
  const ws = await prisma.workspace.findUnique({ where: { slug } });
  if (!ws) return refuse(`workspace "${slug}" não existe.`);
  if (await prisma.user.findUnique({ where: { email } })) return refuse('este e-mail já possui conta; o convite já foi aceito (use reset-password).');
  const invites = await prisma.workspaceInvite.findMany({ where: { workspaceId: ws.id, email, role: 'OWNER', status: { not: 'ACCEPTED' } }, orderBy: { createdAt: 'desc' } });
  if (!invites.length) return refuse('não há convite de dono pendente/expirado para este e-mail neste workspace.');
  const prev = invites[0];
  const { token, hash } = newToken(); const expiresAt = new Date(Date.now() + days * 864e5);
  if (dry) { logDry(`revogaria ${invites.filter(i => i.status === 'PENDING').length} convite(s) pendente(s) e emitiria novo link para ${email} até ${expiresAt.toISOString()}. Nada gravado.`); return; }
  await prisma.$transaction(async tx => {
    await tx.workspaceInvite.updateMany({ where: { workspaceId: ws.id, email, status: 'PENDING' }, data: { status: 'REVOKED' } });
    const invite = await tx.workspaceInvite.create({ data: { workspaceId: ws.id, email, name: prev.name, role: 'OWNER', tokenHash: hash, expiresAt, createdById: 'operator' } });
    await tx.auditLog.create({ data: { workspaceId: ws.id, action: 'operator.invite_reissued', targetType: 'WorkspaceInvite', targetId: invite.id, changes: { ownerEmail: email, inviteDays: days, revokedInviteId: prev.id } } });
  });
  console.log(`Convite reemitido para ${email}, válido até ${expiresAt.toISOString()}.`);
  console.log('Link (exibido uma única vez):');
  console.log(`${url}/convite/${token}`);
}

async function list() {
  const rows = await prisma.workspace.findMany({ orderBy: { createdAt: 'asc' }, select: { name: true, slug: true, createdAt: true, memberships: { where: { isActive: true }, select: { role: true, user: { select: { email: true } } } }, invites: { where: { role: 'OWNER' }, orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, expiresAt: true, email: true } } } });
  if (!rows.length) { console.log('Nenhum workspace.'); return; }
  const now = new Date();
  const out = rows.map(w => {
    const owner = w.memberships.find(m => m.role === 'OWNER')?.user.email ?? w.invites[0]?.email ?? '-';
    const inv = w.invites[0]; const status = !inv ? '-' : inv.status === 'PENDING' && inv.expiresAt <= now ? 'EXPIRED' : inv.status;
    return { slug: w.slug, nome: w.name, dono: owner, convite: status, membros: w.memberships.length, criado: w.createdAt.toISOString().slice(0, 10) };
  });
  console.table(out);
}

try {
  await { 'create-workspace': createWorkspace, 'reset-password': resetPassword, 'reissue-invite': reissueInvite, list }[command]();
} catch (error) {
  console.error(`Falha: ${error?.code ?? error?.name ?? 'erro'} ${String(error?.message ?? '').split('\n').pop()}`); process.exitCode = 1;
} finally { await prisma.$disconnect(); }
