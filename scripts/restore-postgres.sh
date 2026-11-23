#!/usr/bin/env bash
# Restaura um dump (pg_dump -Fc) no banco alvo. DESTRUTIVO: --clean apaga objetos existentes.
# Uso: scripts/restore-postgres.sh ARQUIVO.dump [--yes] [--db NOME] [arquivo-env]
#   DATABASE_URL (alvo) vem do ambiente ou de DATABASE_URL= no arquivo-env.
#   Sem --yes, exige digitar o nome do banco alvo. --db NOME: recusa se o alvo for outro banco.
set -euo pipefail
umask 077

die() { echo "ERRO: $*" >&2; exit 1; }

FILE="" YES=0 EXPECT="" ENVFILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) YES=1 ;;
    --db) shift; EXPECT="${1:-}"; [[ -n "$EXPECT" ]] || die "--db exige um nome" ;;
    -*) die "opcao desconhecida: $1" ;;
    *) if [[ -z "$FILE" ]]; then FILE="$1"; elif [[ -z "$ENVFILE" ]]; then ENVFILE="$1"; else die "argumento extra: $1"; fi ;;
  esac
  shift
done
[[ -n "$FILE" ]] || die "uso: $0 ARQUIVO.dump [--yes] [--db NOME] [arquivo-env]"
[[ -r "$FILE" ]] || die "arquivo de dump ilegivel: $FILE"
command -v pg_restore >/dev/null || die "pg_restore nao encontrado (instale postgresql-client-16)"

if [[ -n "$ENVFILE" ]]; then
  [[ -r "$ENVFILE" ]] || die "arquivo de env ilegivel: $ENVFILE"
  line="$(grep -E '^[[:space:]]*(export[[:space:]]+)?DATABASE_URL=' "$ENVFILE" | tail -n1 || true)"
  [[ -n "$line" ]] || die "DATABASE_URL nao encontrada em $ENVFILE"
  v="${line#*DATABASE_URL=}"; v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
  DATABASE_URL="$v"
fi
[[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL (alvo) nao definida"

urldecode() { local s="${1//+/ }"; printf '%b' "${s//%/\\x}"; }
re='^postgres(ql)?://([^:@/]*)(:([^@]*))?@([^:/?]+)(:([0-9]+))?/([^?]+)(\?.*)?$'
[[ "$DATABASE_URL" =~ $re ]] || die "DATABASE_URL em formato invalido"
export PGUSER; PGUSER="$(urldecode "${BASH_REMATCH[2]}")"
PW="$(urldecode "${BASH_REMATCH[4]:-}")"
export PGHOST="${BASH_REMATCH[5]}" PGPORT="${BASH_REMATCH[7]:-5432}"
DB="$(urldecode "${BASH_REMATCH[8]}")"
unset DATABASE_URL

if [[ -n "$EXPECT" && "$EXPECT" != "$DB" ]]; then
  die "alvo '$DB' difere do banco informado em --db '$EXPECT'; recusando"
fi

echo "Alvo: banco '$DB' em $PGHOST:$PGPORT (usuario $PGUSER). Todos os dados atuais serao substituidos."
if [[ $YES -ne 1 ]]; then
  [[ -t 0 ]] || die "sem terminal para confirmar; use --yes"
  read -r -p "Digite o nome do banco ($DB) para confirmar: " ans
  [[ "$ans" == "$DB" ]] || die "confirmacao nao confere; abortado"
fi

PGPASSFILE="$(mktemp)"; export PGPASSFILE
trap 'rm -f "$PGPASSFILE"' EXIT
esc="${PW//\\/\\\\}"; esc="${esc//:/\\:}"
printf '%s:%s:%s:%s:%s\n' "$PGHOST" "$PGPORT" "$DB" "$PGUSER" "$esc" > "$PGPASSFILE"
chmod 600 "$PGPASSFILE"
unset PW esc

pg_restore --clean --if-exists --no-owner --no-password -d "$DB" "$FILE" || die "pg_restore falhou (veja mensagens acima)"
echo "OK: restore de $FILE concluido em '$DB'"
