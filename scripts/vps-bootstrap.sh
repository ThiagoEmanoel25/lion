#!/usr/bin/env bash
# Monta uma VPS NOVA (Ubuntu 22.04/24.04) para o Zuno Flow, sem dominio proprio (HTTPS em <ip>.sslip.io).
# Rode como root. Idempotente: pode rodar de novo; nao regenera segredos nem sobrescreve o .env.
#
#   sudo bash vps-bootstrap.sh --email voce@exemplo.com [opcoes]
#
# Opcoes (ou variaveis ZUNO_EMAIL, ZUNO_HOST, ZUNO_REPO_URL, ZUNO_BRANCH, ZUNO_DEPLOY_USER, ZUNO_APP_DIR):
#   --email E         OBRIGATORIO (Let's Encrypt)
#   --host H          hostname publico (padrao: IP publico com hifens + .sslip.io); aceita um dominio proprio
#   --repo-url U      padrao https://github.com/ThiagoEmanoel25/lion.git (clone HTTPS, sem credencial)
#   --branch B        padrao main
#   --deploy-user U   padrao zuno
#   --app-dir D       padrao /opt/zuno-flow
#   --skip-certbot    nao emite certificado (fica na config HTTP-only, a menos que o certificado ja exista)
#   --skip-systemd    nao usa systemd/ufw enable/swap/pm2 startup (para teste em container)
#   --dry-run         so imprime o que faria
# Segredos sao gerados uma vez no .env e NUNCA impressos.
set -euo pipefail

EMAIL="${ZUNO_EMAIL:-}"
HOST_NAME="${ZUNO_HOST:-}"
REPO_URL="${ZUNO_REPO_URL:-https://github.com/ThiagoEmanoel25/lion.git}"
BRANCH="${ZUNO_BRANCH:-main}"
DEPLOY_USER="${ZUNO_DEPLOY_USER:-zuno}"
APP_DIR="${ZUNO_APP_DIR:-/opt/zuno-flow}"
SKIP_CERTBOT=0
SKIP_SYSTEMD=0
DRY_RUN=0

log() { printf '\n==> %s\n' "$*"; }
warn() { printf 'AVISO: %s\n' "$*" >&2; }
die() { printf 'ERRO: %s\n' "$*" >&2; exit 1; }

usage() { sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email) EMAIL="${2:-}"; shift 2 ;;
    --host) HOST_NAME="${2:-}"; shift 2 ;;
    --repo-url) REPO_URL="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --deploy-user) DEPLOY_USER="${2:-}"; shift 2 ;;
    --app-dir) APP_DIR="${2:-}"; shift 2 ;;
    --skip-certbot) SKIP_CERTBOT=1; shift ;;
    --skip-systemd) SKIP_SYSTEMD=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "opcao desconhecida: $1 (use --help)" ;;
  esac
done

# ---------- validacao ----------
[[ -n "$EMAIL" ]] || die "--email e obrigatorio (usado pelo Let's Encrypt para avisos de expiracao). Ex.: --email voce@exemplo.com"
[[ "$EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "e-mail invalido: $EMAIL"
[[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]{0,30}$ ]] || die "deploy-user invalido: $DEPLOY_USER"
[[ "$APP_DIR" =~ ^/[A-Za-z0-9_./-]+$ ]] || die "app-dir deve ser um caminho absoluto simples: $APP_DIR"
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || die "branch invalida: $BRANCH"
[[ "$REPO_URL" =~ ^(https://|file://|/)[A-Za-z0-9._~:/@%+-]+$ ]] || die "repo-url invalida: $REPO_URL"
if ((DRY_RUN == 0)) && [[ "$(id -u)" != 0 ]]; then die "rode como root (sudo bash $0 ...)"; fi

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${VERSION_ID:-}" in
    22.04 | 24.04) ;;
    *) die "Ubuntu 22.04 ou 24.04 requerido (encontrado: ${PRETTY_NAME:-desconhecido})" ;;
  esac
  [[ "${ID:-}" == ubuntu ]] || die "so Ubuntu e suportado"
else
  die "/etc/os-release ausente"
fi
CODENAME="${VERSION_CODENAME:-}"

# ---------- helpers ----------
run() {
  if ((DRY_RUN)); then printf '[dry-run] %s\n' "$*"; else "$@"; fi
}

# put ARQUIVO MODO [DONO]: grava stdin no arquivo (atomico).
put() {
  local f="$1" mode="$2" owner="${3:-root:root}" tmp
  if ((DRY_RUN)); then
    cat >/dev/null
    printf '[dry-run] gravaria %s (modo %s, dono %s)\n' "$f" "$mode" "$owner"
    return 0
  fi
  mkdir -p "$(dirname "$f")"
  tmp="$(mktemp "$f.XXXXXX")"
  cat >"$tmp"
  chmod "$mode" "$tmp"
  chown "$owner" "$tmp"
  mv "$tmp" "$f"
}

# as_deploy 'comando shell': roda como usuario de deploy (shell NAO interativo, sem nvm).
as_deploy() {
  if ((DRY_RUN)); then printf '[dry-run] (como %s) %s\n' "$DEPLOY_USER" "$1"; return 0; fi
  sudo -u "$DEPLOY_USER" -H bash -c "$1"
}

apt_install() {
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
}

# systemctl que respeita --skip-systemd
sysctl_do() {
  if ((SKIP_SYSTEMD)); then printf '(skip-systemd) systemctl %s\n' "$*"; return 0; fi
  run systemctl "$@"
}

nginx_reload() {
  if ((SKIP_SYSTEMD)); then
    # Sem systemd (container): inicia o nginx se nao estiver rodando, senao recarrega.
    if ((DRY_RUN)); then echo "[dry-run] nginx (start/reload sem systemd)"; return 0; fi
    if pgrep -x nginx >/dev/null 2>&1; then nginx -s reload; else nginx; fi
  else
    run systemctl enable nginx
    run systemctl reload-or-restart nginx
  fi
}

# ---------- host ----------
detect_host() {
  local ip=""
  ip="$(curl -4 -fsS --max-time 10 ifconfig.me 2>/dev/null || true)"
  if ! [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    ip="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^([0-9]{1,3}\.){3}[0-9]{1,3}$' | head -n1 || true)"
    [[ -n "$ip" ]] && warn "IP publico nao obtido por ifconfig.me; usando $ip de hostname -I (se for privado, o Let's Encrypt falhara: use --host)"
  fi
  [[ -n "$ip" ]] || die "nao foi possivel descobrir o IP; passe --host"
  echo "${ip//./-}.sslip.io"
}
if [[ -z "$HOST_NAME" ]]; then HOST_NAME="$(detect_host)"; fi
HOST_NAME="${HOST_NAME,,}"
[[ "$HOST_NAME" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || die "host invalido: $HOST_NAME"

ENV_FILE="$APP_DIR/.env"
BACKUP_DIR="/var/backups/zunoflow"
NGINX_SITE="/etc/nginx/sites-available/nexo"
CERT_DIR="/etc/letsencrypt/live/$HOST_NAME"
PG_PORT=5432
REDIS_PORT=6379
PG_NAME=zunoflow

cat <<EOF
Zuno Flow - bootstrap da VPS
  host:        $HOST_NAME
  repo/branch: $REPO_URL ($BRANCH)
  deploy-user: $DEPLOY_USER
  app-dir:     $APP_DIR
  dry-run=$DRY_RUN skip-certbot=$SKIP_CERTBOT skip-systemd=$SKIP_SYSTEMD
EOF

# ---------- 1) pacotes essenciais ----------
log "1/17 Atualizando pacotes essenciais"
export DEBIAN_FRONTEND=noninteractive
run apt-get update
apt_install ca-certificates curl gnupg git openssl sudo cron ufw fail2ban unattended-upgrades \
  util-linux procps lsb-release apt-transport-https build-essential python3

# ---------- 2) usuario de deploy ----------
log "2/17 Usuario de deploy ($DEPLOY_USER), sudo minimo e chaves SSH"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  run adduser --disabled-password --gecos "Zuno deploy" --shell /bin/bash "$DEPLOY_USER"
else
  echo "usuario $DEPLOY_USER ja existe"
fi
put "/etc/sudoers.d/zuno-deploy" 0440 root:root <<EOF
# Gerado por vps-bootstrap.sh: o usuario de deploy so pode isto sem senha.
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/pm2, /usr/bin/pm2 *, /usr/bin/systemctl reload nginx
EOF
if ((DRY_RUN == 0)); then
  visudo -cf /etc/sudoers.d/zuno-deploy >/dev/null || { rm -f /etc/sudoers.d/zuno-deploy; die "sudoers invalido (removido)"; }
  echo "sudoers validado (visudo -cf)"
else
  echo "[dry-run] visudo -cf /etc/sudoers.d/zuno-deploy"
fi
if [[ -s /root/.ssh/authorized_keys ]]; then
  if ((DRY_RUN)); then
    echo "[dry-run] copiaria /root/.ssh/authorized_keys para /home/$DEPLOY_USER/.ssh/authorized_keys (700/600)"
  else
    DH="/home/$DEPLOY_USER"
    install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DH/.ssh"
    touch "$DH/.ssh/authorized_keys"
    while IFS= read -r keyline; do
      [[ -n "$keyline" ]] || continue
      grep -qxF -- "$keyline" "$DH/.ssh/authorized_keys" || printf '%s\n' "$keyline" >>"$DH/.ssh/authorized_keys"
    done </root/.ssh/authorized_keys
    chown "$DEPLOY_USER:$DEPLOY_USER" "$DH/.ssh/authorized_keys"
    chmod 600 "$DH/.ssh/authorized_keys"
    echo "chaves do root copiadas para $DEPLOY_USER (mesmo par do administrador)"
  fi
else
  warn "/root/.ssh/authorized_keys ausente ou vazio: instale a chave SSH do deploy em /home/$DEPLOY_USER/.ssh/authorized_keys"
fi

# ---------- 3) fail2ban e unattended-upgrades ----------
log "3/17 fail2ban e unattended-upgrades"
put /etc/fail2ban/jail.d/zuno.local 0644 <<'EOF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
EOF
put /etc/apt/apt.conf.d/20auto-upgrades 0644 <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
sysctl_do enable --now fail2ban
sysctl_do enable --now unattended-upgrades

# ---------- 4) ufw ----------
log "4/17 Firewall ufw (somente 22, 80, 443)"
run ufw default deny incoming
run ufw default allow outgoing
run ufw allow 22/tcp
run ufw allow 80/tcp
run ufw allow 443/tcp
if ((SKIP_SYSTEMD)); then
  echo "(skip-systemd) regras adicionadas, ufw NAO habilitado"
else
  run ufw --force enable # so depois de liberar a 22
fi

# ---------- 5) swap ----------
log "5/17 Swap (2 GB se RAM < ~4 GB)"
MEM_KB="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
if ((SKIP_SYSTEMD)); then
  echo "(skip-systemd) swap ignorado"
elif [[ -f /swapfile || -n "$(swapon --show=NAME --noheadings 2>/dev/null || true)" ]]; then
  echo "swap ja existe"
elif ((MEM_KB < 3500000)); then
  run fallocate -l 2G /swapfile
  run chmod 600 /swapfile
  run mkswap /swapfile
  run swapon /swapfile
  if ((DRY_RUN)); then echo "[dry-run] adicionaria /swapfile ao /etc/fstab"; else grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab; fi
else
  echo "RAM suficiente (${MEM_KB} kB), sem swap"
fi

# ---------- 6) Docker ----------
log "6/17 Docker Engine + compose plugin (repositorio oficial)"
run install -m 0755 -d /etc/apt/keyrings
if [[ ! -s /etc/apt/keyrings/docker.asc ]]; then
  run curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  run chmod a+r /etc/apt/keyrings/docker.asc
fi
put /etc/apt/sources.list.d/docker.list 0644 <<EOF
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $CODENAME stable
EOF
run apt-get update
apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sysctl_do enable --now docker

# ---------- 7) Node 22 ----------
log "7/17 Node 22 (NodeSource, no sistema todo)"
if command -v node >/dev/null 2>&1 && [[ "$(node -v)" == v22.* ]]; then
  echo "node $(node -v) ja instalado"
else
  if [[ ! -s /etc/apt/keyrings/nodesource.gpg ]]; then
    if ((DRY_RUN)); then
      echo "[dry-run] baixaria a chave do NodeSource para /etc/apt/keyrings/nodesource.gpg"
    else
      curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    fi
  fi
  put /etc/apt/sources.list.d/nodesource.list 0644 <<EOF
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main
EOF
  run apt-get update
  apt_install nodejs
fi

# ---------- 8) pm2 ----------
log "8/17 pm2 global (em /usr/bin) e startup systemd"
if [[ -x /usr/bin/pm2 || -x /usr/local/bin/pm2 ]]; then
  echo "pm2 ja instalado"
else
  run npm install -g pm2
fi
if ((SKIP_SYSTEMD)); then
  echo "(skip-systemd) pm2 startup ignorado"
else
  run pm2 startup systemd -u "$DEPLOY_USER" --hp "/home/$DEPLOY_USER"
  # sobe o pm2 depois do Docker (Postgres/Redis)
  put "/etc/systemd/system/pm2-$DEPLOY_USER.service.d/10-docker.conf" 0644 <<'EOF'
[Unit]
After=docker.service
Wants=docker.service
EOF
  run systemctl daemon-reload
fi

# ---------- 9) nginx, certbot, cliente pg ----------
log "9/17 nginx, certbot e postgresql-client-16 (para o backup)"
apt_install nginx certbot python3-certbot-nginx
PG_POLICY="$(apt-cache policy postgresql-client-16 2>/dev/null || true)"
if [[ "$PG_POLICY" != *"Candidate: "[0-9]* ]]; then
  # Ubuntu 22.04 so tem o cliente 14 (nao le dump de servidor 16): usa o repositorio PGDG.
  echo "postgresql-client-16 indisponivel no repositorio padrao: adicionando PGDG"
  run install -m 0755 -d /usr/share/postgresql-common/pgdg
  run curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  put /etc/apt/sources.list.d/pgdg.list 0644 <<EOF
deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $CODENAME-pgdg main
EOF
  run apt-get update
fi
apt_install postgresql-client-16
# O cliente roda no HOST (pg_dump em 127.0.0.1:5432, direto do scripts/backup-postgres.sh).

# ---------- 10) clone ----------
log "10/17 Codigo em $APP_DIR (dono: $DEPLOY_USER)"
run install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
  echo "repositorio ja clonado; atualizando (ff-only)"
  as_deploy "cd '$APP_DIR' && git fetch origin '$BRANCH' && git checkout '$BRANCH' && git merge --ff-only 'origin/$BRANCH'" \
    || warn "nao foi possivel atualizar o repositorio (alteracoes locais?); seguindo com o que esta no disco"
else
  if ((DRY_RUN == 0)) && [[ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ]]; then die "$APP_DIR nao esta vazio e nao e um repositorio git"; fi
  as_deploy "git clone --branch '$BRANCH' --single-branch '$REPO_URL' '$APP_DIR'"
fi

# ---------- 11) .env (uma vez) ----------
log "11/17 Arquivo $ENV_FILE"
if [[ -e "$ENV_FILE" ]]; then
  echo ".env ja existe: NAO sobrescrito (segredos preservados)"
  chown "$DEPLOY_USER:$DEPLOY_USER" "$ENV_FILE" 2>/dev/null || true
  chmod 600 "$ENV_FILE" 2>/dev/null || true
elif ((DRY_RUN)); then
  echo "[dry-run] geraria $ENV_FILE (600, $DEPLOY_USER) com JWT_SECRET, FIELD_ENCRYPTION_KEY e senha do Postgres: gerado"
else
  JWT_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  FIELD_ENCRYPTION_KEY="$(openssl rand -base64 32 | tr -d '\n')"
  PG_PASSWORD="$(openssl rand -hex 24)"
  put "$ENV_FILE" 0600 "$DEPLOY_USER:$DEPLOY_USER" <<EOF
# Gerado por scripts/vps-bootstrap.sh. NAO versionar. FIELD_ENCRYPTION_KEY nao pode ser trocada depois sem migrar dados cifrados.
NODE_ENV=production
API_PORT=3333
WEB_ORIGIN=https://$HOST_NAME
PUBLIC_API_URL=https://$HOST_NAME/api
PUBLIC_WEB_URL=https://$HOST_NAME
TRUST_PROXY=loopback
LOG_LEVEL=info

# Postgres/Redis em Docker, presos a 127.0.0.1 (infra/docker-compose.prod.yml)
POSTGRES_USER=$PG_NAME
POSTGRES_DB=$PG_NAME
POSTGRES_PASSWORD=$PG_PASSWORD
DATABASE_URL=postgresql://$PG_NAME:$PG_PASSWORD@127.0.0.1:$PG_PORT/$PG_NAME?schema=public
REDIS_URL=redis://127.0.0.1:$REDIS_PORT

JWT_SECRET=$JWT_SECRET
FIELD_ENCRYPTION_KEY=$FIELD_ENCRYPTION_KEY

WHATSAPP_PROVIDER=baileys
WHATSAPP_CONNECT_CONCURRENCY=4
WHATSAPP_MESSAGE_CONCURRENCY=20
WHATSAPP_SESSION_LOCK_TTL_MS=30000
META_APP_SECRET=
META_VERIFY_TOKEN=
META_ACCESS_TOKEN=
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_DEFAULT_MODEL=gpt-4o-mini
STRIPE_SECRET_KEY=

LOGIN_RATE_MAX=20
LOGIN_RATE_WINDOW_SEC=60
LOGIN_LOCKOUT_MAX_FAILS=5
LOGIN_LOCKOUT_WINDOW_SEC=900
LOGIN_LOCKOUT_SEC=900
REFRESH_RATE_MAX=30
REFRESH_RATE_WINDOW_SEC=60
INVITE_RATE_MAX=10
INVITE_RATE_WINDOW_SEC=60
EOF
  unset JWT_SECRET FIELD_ENCRYPTION_KEY PG_PASSWORD
  echo ".env gerado (JWT_SECRET: gerado; FIELD_ENCRYPTION_KEY: gerado; senha do Postgres: gerado)"
fi

# ---------- 12) compose de producao ----------
log "12/17 Postgres + Redis (docker compose, somente 127.0.0.1)"
if ((DRY_RUN)); then
  echo "[dry-run] docker compose --env-file $ENV_FILE -f $APP_DIR/infra/docker-compose.prod.yml up -d --wait"
else
  docker info >/dev/null 2>&1 || die "o daemon do Docker nao esta rodando"
  docker compose --env-file "$ENV_FILE" -f "$APP_DIR/infra/docker-compose.prod.yml" up -d --wait
fi

# ---------- 13) app ----------
log "13/17 npm ci, db:generate, db:deploy, build (como $DEPLOY_USER)"
as_deploy "cd '$APP_DIR' && npm ci"
as_deploy "cd '$APP_DIR' && npm run db:generate"
as_deploy "cd '$APP_DIR' && npm run db:deploy"
as_deploy "cd '$APP_DIR' && npm run build"

# ---------- 14) nginx (HTTP-only -> certbot -> final) ----------
log "14/17 Nginx: HTTP-only inicial, certificado, config final com TLS"
render_nginx() { # $1 = modelo
  sed -e "s|nexo.example.com|$HOST_NAME|g" -e "s|REPO_PATH|$APP_DIR|g" "$APP_DIR/infra/nginx/$1"
}
if ((DRY_RUN)); then
  echo "[dry-run] copiaria nexo-security-headers.conf para /etc/nginx/snippets/ e instalaria $NGINX_SITE (HTTP-only), nginx -t, reload"
else
  install -d -m 755 /var/www/certbot /etc/nginx/snippets
  install -m 644 "$APP_DIR/infra/nginx/nexo-security-headers.conf" /etc/nginx/snippets/nexo-security-headers.conf
  rm -f /etc/nginx/sites-enabled/default
  if [[ ! -s "$CERT_DIR/fullchain.pem" ]]; then
    render_nginx nexo-http-bootstrap.conf | put "$NGINX_SITE" 0644
    ln -sfn "$NGINX_SITE" /etc/nginx/sites-enabled/nexo
    nginx -t
    nginx_reload
  fi
fi
if [[ -s "$CERT_DIR/fullchain.pem" ]]; then
  echo "certificado ja existe em $CERT_DIR"
elif ((SKIP_CERTBOT)); then
  echo "(skip-certbot) sem certificado: permanece a config HTTP-only"
else
  run certbot certonly --webroot -w /var/www/certbot -d "$HOST_NAME" -m "$EMAIL" --agree-tos --no-eff-email --non-interactive
fi
if ((DRY_RUN)); then
  echo "[dry-run] se o certificado existir: instalaria a config final (nexo.conf), nginx -t, reload"
elif [[ -s "$CERT_DIR/fullchain.pem" ]]; then
  render_nginx nexo.conf | put "$NGINX_SITE" 0644
  ln -sfn "$NGINX_SITE" /etc/nginx/sites-enabled/nexo
  nginx -t
  nginx_reload
  echo "config final (TLS + redirecionamento + headers) ativa"
else
  warn "sem certificado: o site segue so em HTTP. Rode de novo sem --skip-certbot quando o DNS/portas estiverem prontos"
fi

# ---------- 15) renovacao ----------
log "15/17 Renovacao automatica do certificado"
put /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh 0755 <<'EOF'
#!/bin/sh
systemctl reload nginx
EOF
sysctl_do enable --now certbot.timer

# ---------- 16) pm2 ----------
log "16/17 pm2 start + save"
as_deploy "cd '$APP_DIR' && pm2 startOrReload ecosystem.config.cjs --env production && pm2 save"

# ---------- 17) backup diario ----------
log "17/17 Backup diario do Postgres (cron, 03:15, retencao 14 dias)"
run install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BACKUP_DIR"
put /etc/cron.d/zunoflow-backup 0644 <<EOF
# Gerado por vps-bootstrap.sh (pg_dump do host contra 127.0.0.1:$PG_PORT)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
15 3 * * * $DEPLOY_USER BACKUP_DIR=$BACKUP_DIR RETENTION_DAYS=14 bash $APP_DIR/scripts/backup-postgres.sh $ENV_FILE >> /var/log/zunoflow-backup.log 2>&1
EOF
if ((DRY_RUN == 0)); then
  touch /var/log/zunoflow-backup.log
  chown "$DEPLOY_USER:$DEPLOY_USER" /var/log/zunoflow-backup.log
  chmod 640 /var/log/zunoflow-backup.log
fi

# ---------- resumo (sem segredos) ----------
log "Resumo"
if ((DRY_RUN)); then
  echo "[dry-run] nada foi alterado."
  exit 0
fi
SCHEME=http
[[ -s "$CERT_DIR/fullchain.pem" ]] && SCHEME=https
ok=0
for _ in 1 2 3 4 5 6; do
  if curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:3333/health 2>/dev/null; then ok=1; break; fi
  sleep 5
done
cat <<EOF
URL:            $SCHEME://$HOST_NAME
API /health:    $( ((ok)) && echo OK || echo "FALHOU (veja: sudo -u $DEPLOY_USER pm2 logs)")
Servicos:
EOF
as_deploy "pm2 status" || true
docker compose --env-file "$ENV_FILE" -f "$APP_DIR/infra/docker-compose.prod.yml" ps || true
cat <<EOF

Primeiro cliente (o link do convite aparece UMA vez):
  sudo -u $DEPLOY_USER node $APP_DIR/scripts/operator.mjs --env-file $ENV_FILE create-workspace --name "Clinica X" --slug clinica-x --owner-email dono@x.com

Checklist de verificacao:
  [ ] curl -sI http://$HOST_NAME/ | head -1        (301 para https)
  [ ] curl -s https://$HOST_NAME/api/health ; curl -s https://$HOST_NAME/api/ready
  [ ] curl -sI https://$HOST_NAME/ | grep -i strict-transport
  [ ] ss -tlnp | grep -E ':(5432|6379)'            (somente 127.0.0.1)
  [ ] ufw status verbose                           (so 22, 80, 443)
  [ ] sudo -u $DEPLOY_USER pm2 status ; systemctl status pm2-$DEPLOY_USER
  [ ] certbot renew --dry-run
  [ ] sudo -u $DEPLOY_USER bash $APP_DIR/scripts/backup-postgres.sh $ENV_FILE
  [ ] CI: configure VPS_HOST/VPS_USER/VPS_SSH_KEY/VPS_PATH=$APP_DIR/VPS_HEALTH_URL=https://$HOST_NAME/api/health
EOF
