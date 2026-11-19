# Deploy em VPS (PM2 + Nginx)

Pré-requisitos no servidor: Node >= 22, PM2 (`npm i -g pm2`), Nginx, PostgreSQL e Redis acessíveis, certbot (TLS).

1. `git clone <repo> && cd <repo> && npm ci`
2. `cp .env.production.example .env` → preencher (JWT_SECRET, FIELD_ENCRYPTION_KEY, DATABASE_URL, REDIS_URL, domínio); `chmod 600 .env`
3. `npm run db:generate && npm run db:deploy` (nunca `db:migrate` em produção)
4. `npm run build` (gera `apps/api/dist`, `apps/runtime/dist`, `apps/web/dist`)
5. `pm2 start ecosystem.config.cjs --env production && pm2 save && pm2 startup`
6. Nginx: copiar `infra/nginx/nexo.conf`, trocar domínio e `REPO_PATH`, `nginx -t && systemctl reload nginx`, depois `certbot --nginx`
7. Verificar: `curl https://DOMINIO/api/health` e `/api/ready`

Notas: manter `nexo-runtime` em 1 instância (sessões Baileys). Não rode o seed em produção (cria admin de desenvolvimento). Atualizações: `git pull && npm ci && npm run db:deploy && npm run build && pm2 reload ecosystem.config.cjs`.

## CI/CD (GitHub Actions)

- `.github/workflows/ci.yml`: typecheck, testes, build e E2E Playwright (Postgres+Redis efêmeros, seed, prints das telas em desktop e mobile enviados como artefato `screenshots`).
- `.github/workflows/deploy.yml`: após CI verde na `main` (ou manual), conecta por SSH, faz `npm ci`, `db:deploy`, `build` e `pm2 startOrReload`, depois checa a saúde.
- Secrets do environment `production` (criar manualmente; nada é versionado): `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (chave dedicada de deploy), `VPS_KNOWN_HOSTS` (`ssh-keyscan HOST`), `VPS_PATH`, `VPS_HEALTH_URL` (ex.: https://DOMINIO/api/health). Ative "Required reviewers" nesse environment.

## Testes E2E e prints (local)

`npm run test:e2e:install` (1ª vez), `docker compose -f infra/docker-compose.yml up -d`, `npm run db:deploy && npm run db:seed`, `npm run test:e2e`.
Prints em `e2e/screenshots/{desktop,mobile}/`; relatório em `e2e/report/`. Rode a cada mudança de frontend e revise os prints.
