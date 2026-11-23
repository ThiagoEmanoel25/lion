#!/usr/bin/env bash
# Deploy NO servidor (chamado pelo workflow via SSH). Uso: bash scripts/deploy-remote.sh SHA
# Variaveis: APP_PATH (default: raiz do repo), ENV_FILE (default .env), BACKUP_DIR
# (default /var/backups/zunoflow), HEALTH_URL (base ex.: https://DOMINIO/api; aceita
# terminar em /health), HEALTH_TRIES (6), HEALTH_SLEEP (5), LOCK_FILE, BACKUP_SCRIPT.
# Migracoes so vao para frente: o banco NUNCA e revertido automaticamente.
set -euo pipefail

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERRO: $*" >&2; exit 1; }

TARGET="${1:-}"
[[ "$TARGET" =~ ^[0-9a-fA-F]{7,40}$ ]] || die "uso: deploy-remote.sh SHA (7 a 40 hex)"

APP_PATH="${APP_PATH:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${ENV_FILE:-.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/zunoflow}"
HEALTH_URL="${HEALTH_URL:-}"
HEALTH_TRIES="${HEALTH_TRIES:-6}"
HEALTH_SLEEP="${HEALTH_SLEEP:-5}"
LOCK_FILE="${LOCK_FILE:-/tmp/zunoflow-deploy.lock}"
BACKUP_SCRIPT="${BACKUP_SCRIPT:-$APP_PATH/scripts/backup-postgres.sh}"
export BACKUP_DIR

[[ -n "$HEALTH_URL" ]] || die "HEALTH_URL nao definida"
HEALTH_BASE="${HEALTH_URL%/}"; HEALTH_BASE="${HEALTH_BASE%/health}"

cd "$APP_PATH"

# Trava de concorrencia: um deploy por vez.
exec 9>"$LOCK_FILE"
flock -n 9 || die "outro deploy em andamento (lock $LOCK_FILE)"

# PREV_SHA vem do workflow (capturado antes do checkout do alvo). Sem ele, HEAD e o melhor palpite
# (execucao manual com o repositorio ainda no commit antigo).
PREV_SHA="${PREV_SHA:-$(git rev-parse HEAD)}"
[[ "$PREV_SHA" =~ ^[0-9a-fA-F]{7,40}$ ]] || die "PREV_SHA invalido"
START="$(date -u +%Y%m%dT%H%M%SZ)"
log "deploy iniciado: anterior=$PREV_SHA alvo=$TARGET data=$START"
[[ "$PREV_SHA" != "$(git rev-parse "$TARGET")" ]] || log "AVISO: SHA anterior = alvo; o rollback nao tera para onde voltar"

check_health() {
  local i ok
  for ((i = 1; i <= HEALTH_TRIES; i++)); do
    ok=1
    curl -fsS --max-time 10 -o /dev/null "$HEALTH_BASE/health" || ok=0
    if ((ok)); then curl -fsS --max-time 10 -o /dev/null "$HEALTH_BASE/ready" || ok=0; fi
    if ((ok)); then log "health ok (/health e /ready) na tentativa $i"; return 0; fi
    log "health falhou (tentativa $i/$HEALTH_TRIES)"
    ((i < HEALTH_TRIES)) && sleep "$HEALTH_SLEEP"
  done
  return 1
}

# 1) Backup ANTES de qualquer migracao; falha aborta o deploy.
log "backup do banco em $BACKUP_DIR"
BACKUP_OUT="$(bash "$BACKUP_SCRIPT" "$ENV_FILE")" || die "backup falhou; deploy abortado, nada foi alterado"
echo "$BACKUP_OUT"
BACKUP_FILE="$(printf '%s\n' "$BACKUP_OUT" | sed -n 's/^OK: backup gravado em \(.*\) (.*$/\1/p' | tail -n1)"
BACKUP_FILE="${BACKUP_FILE:-<ver $BACKUP_DIR>}"

# 2) Checkout do alvo e etapas de deploy.
log "git fetch"
git fetch --all --prune || die "git fetch falhou; nada foi alterado"

# Obs.: chamada dentro de "if", entao "set -e" nao vale aqui; cada etapa usa "|| return 1".
deploy() {
  log "checkout $TARGET"; git checkout --detach "$TARGET" || return 1
  log "npm ci"; npm ci || return 1
  log "db:generate"; npm run db:generate || return 1
  log "db:deploy (migracoes)"; npm run db:deploy || return 1
  log "build"; npm run build || return 1
  log "pm2 startOrReload"; pm2 startOrReload ecosystem.config.cjs --env production || return 1
  check_health
}

rollback() {
  log "ROLLBACK: voltando ao SHA anterior $PREV_SHA"
  local rc=0
  {
    git checkout --detach "$PREV_SHA" &&
      npm ci &&
      npm run db:generate &&
      npm run build &&
      pm2 startOrReload ecosystem.config.cjs --env production
  } || rc=1
  if ((rc)); then
    log "ROLLBACK FALHOU em alguma etapa; intervencao manual necessaria"
  elif check_health; then
    log "ROLLBACK CONCLUIDO: codigo antigo ($PREV_SHA) no ar e saudavel"
  else
    log "ROLLBACK aplicado, mas o health continua falhando"
  fi
}

main() {
if deploy; then
  pm2 save || log "aviso: pm2 save falhou"
  log "deploy concluido: $TARGET"
  return 0
fi

log "DEPLOY FALHOU; houve tentativa de ROLLBACK do codigo para $PREV_SHA"
rollback
cat <<MSG
================ ATENCAO ================
O BANCO NAO FOI REVERTIDO (migracoes so vao para frente).
Se a migracao (db:deploy) foi aplicada e e incompativel com o codigo antigo,
restaure o backup feito antes do deploy:
  backup: $BACKUP_FILE
  pm2 stop all
  bash scripts/restore-postgres.sh "$BACKUP_FILE" --db NOME_DO_BANCO $ENV_FILE
  pm2 start all
=========================================
MSG
return 1
}
# Tudo roda dentro de main() e termina na MESMA linha: o rollback faz git checkout e pode reescrever
# este arquivo enquanto o bash ainda o le; assim nada alem desta linha e lido do disco.
main "$@"; exit $?
