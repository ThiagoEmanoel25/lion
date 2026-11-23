#!/usr/bin/env bash
# Backup do Postgres (pg_dump -Fc) com retencao.
# Uso: scripts/backup-postgres.sh [arquivo-env]
#   DATABASE_URL vem do ambiente ou da linha DATABASE_URL= do arquivo-env (nao e executado).
#   BACKUP_DIR (default /var/backups/zunoflow, fora do repo), RETENTION_DAYS (default 14).
set -euo pipefail
umask 077

die() { echo "ERRO: $*" >&2; exit 1; }

BACKUP_DIR="${BACKUP_DIR:-/var/backups/zunoflow}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || die "RETENTION_DAYS invalido: $RETENTION_DAYS"
command -v pg_dump >/dev/null || die "pg_dump nao encontrado (instale postgresql-client-16)"

if [[ $# -ge 1 ]]; then
  [[ -r "$1" ]] || die "arquivo de env ilegivel: $1"
  line="$(grep -E '^[[:space:]]*(export[[:space:]]+)?DATABASE_URL=' "$1" | tail -n1 || true)"
  [[ -n "$line" ]] || die "DATABASE_URL nao encontrada em $1"
  v="${line#*DATABASE_URL=}"; v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
  DATABASE_URL="$v"
fi
[[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL nao definida (ambiente ou arquivo de env)"

urldecode() { local s="${1//+/ }"; printf '%b' "${s//%/\\x}"; }
re='^postgres(ql)?://([^:@/]*)(:([^@]*))?@([^:/?]+)(:([0-9]+))?/([^?]+)(\?.*)?$'
[[ "$DATABASE_URL" =~ $re ]] || die "DATABASE_URL em formato invalido (esperado postgresql://user:senha@host:porta/banco)"
export PGUSER; PGUSER="$(urldecode "${BASH_REMATCH[2]}")"
PW="$(urldecode "${BASH_REMATCH[4]:-}")"
export PGHOST="${BASH_REMATCH[5]}" PGPORT="${BASH_REMATCH[7]:-5432}"
DB="$(urldecode "${BASH_REMATCH[8]}")"
unset DATABASE_URL

# Senha via PGPASSFILE temporario (600), nunca na linha de comando.
PGPASSFILE="$(mktemp)"; export PGPASSFILE
trap 'rm -f "$PGPASSFILE" "${TMP:-}"' EXIT
esc="${PW//\\/\\\\}"; esc="${esc//:/\\:}"
printf '%s:%s:%s:%s:%s\n' "$PGHOST" "$PGPORT" "$DB" "$PGUSER" "$esc" > "$PGPASSFILE"
chmod 600 "$PGPASSFILE"
unset PW esc

mkdir -p "$BACKUP_DIR" || die "nao foi possivel criar $BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true
OUT="$BACKUP_DIR/${DB}_$(date +%Y%m%d_%H%M%S).dump"
TMP="$OUT.partial"

pg_dump -Fc --no-password -d "$DB" -f "$TMP" || die "pg_dump falhou (banco $DB em $PGHOST:$PGPORT)"
[[ -s "$TMP" ]] || die "dump vazio"
chmod 600 "$TMP"
mv "$TMP" "$OUT"

find "$BACKUP_DIR" -maxdepth 1 -type f -name "${DB}_*.dump" -mtime +"$RETENTION_DAYS" -delete
echo "OK: backup gravado em $OUT ($(wc -c < "$OUT") bytes); retencao ${RETENTION_DAYS} dias"
