# Deploy em VPS (PM2 + Nginx)

Pré-requisitos no servidor: Node >= 22, PM2 (`npm i -g pm2`), Nginx, PostgreSQL e Redis acessíveis, certbot (TLS).

1. `git clone <repo> && cd <repo> && npm ci`
2. `cp .env.production.example .env` → preencher (JWT_SECRET, FIELD_ENCRYPTION_KEY, DATABASE_URL, REDIS_URL, domínio); `chmod 600 .env`
3. `npm run db:generate && npm run db:deploy` (nunca `db:migrate` em produção)
4. `npm run build` (gera `apps/api/dist`, `apps/runtime/dist`, `apps/web/dist`)
5. `pm2 start ecosystem.config.cjs --env production && pm2 save && pm2 startup`
6. Nginx: copiar `infra/nginx/nexo.conf` e `nexo-security-headers.conf` (para `/etc/nginx/snippets/`), trocar domínio e `REPO_PATH`; emitir o certificado antes (seção TLS e headers)
7. Verificar: `curl https://DOMINIO/api/health` e `/api/ready`

Notas: manter `nexo-runtime` em 1 instância (sessões Baileys). Não rode o seed em produção (cria admin de desenvolvimento; recusa sem `ALLOW_SEED_IN_PRODUCTION=1`). Com `NODE_ENV=production`, API e runtime saem com código 1 se faltar/for placeholder: DATABASE_URL, REDIS_URL, JWT_SECRET (>=32), FIELD_ENCRYPTION_KEY (base64, 32 bytes), WEB_ORIGIN, PUBLIC_API_URL (https). Atualizações: `git pull && npm ci && npm run db:deploy && npm run build && pm2 reload ecosystem.config.cjs`.

## CI/CD (GitHub Actions)

- `.github/workflows/ci.yml`: typecheck, testes, build e E2E Playwright (Postgres+Redis efêmeros, seed, prints das telas em desktop e mobile enviados como artefato `screenshots`).
- `.github/workflows/deploy.yml`: após CI verde na `main` (ou manual), conecta por SSH, faz `npm ci`, `db:deploy`, `build` e `pm2 startOrReload`, depois checa a saúde.
- Secrets do environment `production` (criar manualmente; nada é versionado): `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (chave dedicada de deploy), `VPS_KNOWN_HOSTS` (`ssh-keyscan HOST`), `VPS_PATH`, `VPS_HEALTH_URL` (ex.: https://DOMINIO/api/health). Ative "Required reviewers" nesse environment.
- Rollback e backup pré-migração: o deploy roda `scripts/deploy-remote.sh SHA` no servidor (com `flock` contra deploys simultâneos). Ele faz backup do Postgres ANTES de migrar (se falhar, aborta sem alterar nada), aplica `db:deploy`, `build`, `pm2 startOrReload` e checa `/health` e `/ready`. Se algo falhar após o checkout, volta o código ao SHA anterior (`npm ci`, `db:generate`, `build`, `pm2`), confere o health e sai com código != 0 (a saída diz "ROLLBACK"). O banco NUNCA é revertido sozinho (migrações só vão para frente): se a migração já foi aplicada e é incompatível com o código antigo, restaure à mão: `pm2 stop all`, `scripts/restore-postgres.sh /var/backups/zunoflow/BANCO_AAAAMMDD_HHMMSS.dump --db BANCO .env` (o caminho exato é impresso no fim da saída do deploy), `pm2 start all`. Variáveis opcionais (secrets do environment): `BACKUP_DIR` (default `/var/backups/zunoflow`) e `ENV_FILE` (default `.env`, de onde sai `DATABASE_URL`). `VPS_HEALTH_URL` é a base da API (ex.: https://DOMINIO/api; terminar em `/health` também funciona).

## TLS e headers
1. Emitir o certificado (o bloco 443 só carrega depois disso): `mkdir -p /var/www/certbot`, deixar só o bloco 80 ativo (comentar o 443) e `certbot certonly --webroot -w /var/www/certbot -d DOMINIO`. Renovação automática: `certbot renew --dry-run`.
2. Descomentar/ativar o bloco 443, `nginx -t && systemctl reload nginx`. Conferir: `curl -sI http://DOMINIO/` (301 para https) e `curl -sI https://DOMINIO/` (HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, CSP).
3. A CSP do SPA sai como `Content-Security-Policy-Report-Only` (não bloqueia). Navegue pelo app com o console aberto e corrija o que aparecer como violação. Quando limpo, em `nexo-security-headers.conf` troque `Content-Security-Policy-Report-Only` por `Content-Security-Policy` e recarregue o Nginx.
4. HSTS (1 ano, sem `preload`): só funciona depois que o HTTPS estiver estável; difícil de desfazer. Para testar, reduza `max-age` antes. A API ainda envia seus headers via `@fastify/helmet`.

## Testes E2E e prints (local)

`npm run test:e2e:install` (1ª vez), `docker compose -f infra/docker-compose.yml up -d`, `npm run db:deploy && npm run db:seed`, `npm run test:e2e`.
Prints em `e2e/screenshots/{desktop,mobile}/`; relatório em `e2e/report/`. Rode a cada mudança de frontend e revise os prints.

## Logs e observabilidade

- API e runtime logam em JSON (pino) com `service`, `time` ISO, `reqId`; requisições autenticadas incluem `userId` e `workspaceId` e `responseTime`. O header `x-request-id` é aceito e devolvido em toda resposta: peça ao usuário esse id para achar o erro (`grep REQ_ID logs/*.log`).
- 4xx saem como `warn`, 5xx como `error`; `unhandledRejection`/`uncaughtException` são registrados antes de encerrar. Segredos (authorization, cookie, password, token, apiKey) são mascarados com `[REDACTED]`.
- `LOG_LEVEL` (debug|info|warn|error) controla o nível; `debug` também loga queries Prisma (não usar em produção).
- PM2 grava em `logs/out.log` e `logs/err.log`. Rotação: `pm2 install pm2-logrotate && pm2 set pm2-logrotate:max_size 20M && pm2 set pm2-logrotate:retain 14`. Ver ao vivo: `pm2 logs`; filtrar: `pm2 logs nexo-api | jq 'select(.level>=50)'`.
- Próximo passo opcional: enviar os logs a Loki/Grafana, Datadog ou Better Stack e criar alerta para `level>=50` e para `/ready` 503; não implementado.

## Backup e restore

**Por que importa:** as credenciais das sessões WhatsApp (Baileys) e as chaves Signal ficam no Postgres. Perder o banco derruba todas as sessões (todos os números precisam reescanear o QR). Backup do banco = backup das sessões.

- Backup: `scripts/backup-postgres.sh /caminho/.env` (ou `DATABASE_URL` no ambiente). Gera `pg_dump -Fc` em `BACKUP_DIR` (default `/var/backups/zunoflow`, fora do repo), arquivo `BANCO_AAAAMMDD_HHMMSS.dump` com permissão 600; apaga dumps com mais de `RETENTION_DAYS` (default 14). A senha nunca vai na linha de comando nem é impressa. Requer `postgresql-client-16`.
- Agendamento diário (cron do usuário que roda a app): `15 3 * * * cd /srv/zunoflow && scripts/backup-postgres.sh .env >> /var/log/zunoflow-backup.log 2>&1`. Alternativa: systemd timer (`OnCalendar=*-*-* 03:15:00`, `Persistent=true`) chamando o mesmo comando. Alerte se o log não tiver `OK:` do dia.
- Cópia off-site (a escolher pelo dono): bucket S3/B2/R2 (`rclone copy /var/backups/zunoflow remoto:bucket`), outro servidor via `rsync`/`scp`, etc. Backup só na mesma VPS não protege contra perda do servidor. Considere criptografar (ex.: `age`/`gpg`) antes de enviar, pois o dump contém credenciais.
- Restore: `scripts/restore-postgres.sh ARQUIVO.dump [--db NOME] [.env-alvo]`. Pede para digitar o nome do banco (ou `--yes` para automação); `--db` recusa se o alvo for outro banco. Usa `pg_restore --clean --if-exists --no-owner`. Pare `nexo-api` e `nexo-runtime` antes (`pm2 stop all`) e suba depois.
- Teste de restore recorrente (ao menos mensal): restaurar o último dump em um banco descartável e conferir contagens (`User`, `Contact`, `Message`) e subir a API contra ele.
- Sem `pg_dump` no host: `docker run --rm --network host -v /srv/zunoflow:/app -v /var/backups/zunoflow:/var/backups/zunoflow -e DATABASE_URL postgres:16 bash /app/scripts/backup-postgres.sh`.
- Redis (filas/cache): em `redis.conf` use `appendonly yes`, `appendfsync everysec`, `maxmemory 256mb` (ajuste) e `maxmemory-policy noeviction` (filas não devem perder jobs). Redis não substitui o backup do Postgres.
