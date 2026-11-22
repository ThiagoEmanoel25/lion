# Revisão do projeto (task 00)

Auditoria somente leitura (grep/leitura + `npm audit --omit=dev`). Nada foi executado (build, testes, servidores, docker, E2E). Valores de `.env` não foram lidos. Esforço: P (horas), M (1-3 dias), G (>3 dias).

## P0 (bloqueia produção / risco alto)

### P0-1. Sem rate limit nem lockout em login e refresh
- Evidência: `apps/api/src/modules/auth/routes.ts:4-5` (rotas públicas sem limite); `apps/api/package.json` não tem `@fastify/rate-limit`. O único rate limit existente é por recurso: `rateLimit` em `imports/routes.ts:132` e `webhooks/routes.ts:50`, `integrationTestRateLimit` em playbooks. Rota pública `/v1/invitations/accept` (`workspaces/routes.ts:26`) também sem limite.
- Impacto: força bruta de senha e abuso de convites. Esforço: P.

### P0-2. Webhook Meta aceita payload sem assinatura quando `META_APP_SECRET` está vazio
- Evidência: `apps/api/src/modules/webhooks/routes.ts:46` (`if(process.env.META_APP_SECRET&&!validMetaSignature(...))`); `.env.example:16` e `.env.production.example:17` deixam a variável vazia. A assinatura é validada sobre `JSON.stringify(request.body)`, não sobre o corpo bruto (pode divergir do que a Meta assinou).
- Impacto: eventos forjados gravados em `rawWebhookEvent` em produção mal configurada; validação pode falhar com payload legítimo. Esforço: P (falhar fechado em produção + usar rawBody como em `/v1/hooks/:publicId`).

### P0-3. Dependências de produção com vulnerabilidades (`npm audit --omit=dev`)
- Comando: `npm audit --omit=dev` retorna 6 vulnerabilidades (5 high, 1 moderate): `zod <4.6.6` (DoS de memória; API usa `zod ^3.24.2`, fix exige major), `follow-redirects 1.16.0-1.16.1` (high), `effect <=3.22.0` via `@prisma/config`/`prisma` (high), `fast-uri` (moderate). Contradiz `docs/STATUS.md` ("zero vulnerabilidades"), que está desatualizado.
- Impacto: alguns são transitivos de ferramenta (prisma CLI), mas zod valida entrada pública. Esforço: P para `npm audit fix` (follow-redirects, fast-uri); M para zod 3->4 e prisma.
- Não verificado: alcance real (exploitability) de cada advisory.

### P0-4. Sem backup/restore de Postgres documentado
- Evidência: `grep -rniE "backup|pg_dump" docs README.md infra .github` não retorna nada (só a task). Postgres e Redis em volume Docker simples (`infra/docker-compose.yml`). Credenciais do WhatsApp (Baileys) e chaves Signal ficam no banco (`apps/runtime/src/whatsapp/auth-state.store.ts`): perder o banco derruba as sessões de todos os canais.
- Impacto: perda de dados irrecuperável. Esforço: P/M (pg_dump agendado, teste de restore, retenção).

## P1 (importante no próximo corte)

### P1-1. Cabeçalhos de segurança ausentes
- Evidência: nenhum `helmet` ou headers manuais em `apps/api/src` (grep); `infra/nginx/nexo.conf` não define HSTS, CSP, X-Content-Type-Options, X-Frame-Options; nginx só escuta na porta 80 (TLS via certbot manual, comentário no arquivo). Esforço: P.

### P1-2. Assets servidos `inline` com content-type controlado pelo cliente
- Evidência: `apps/api/src/modules/assets/routes.ts:34-40` (`contentTypeOf(x-file-content-type)` salvo e devolvido com `content-disposition: inline`). Exige Bearer, o que reduz o risco, mas um `text/html` enviado por um editor executa na origem da API se aberto direto. Não verifiquei `contentTypeOf` (allowlist) em detalhe. Esforço: P (allowlist de MIME, `X-Content-Type-Options: nosniff`, `attachment` para tipos não-mídia). Arquivos ficam no próprio Postgres (`data` bytea, limite 10 MB): crescimento do banco e backups (M para mover a object storage).

### P1-3. Tenant isolation: sem teste dedicado e sem barreira estrutural
- Evidência: isolamento depende de `workspaceId` escrito à mão em cada query (ex.: `assets/routes.ts:38` `findFirst({where:{id,workspaceId}})`). Há rotas que atualizam por `id` após checagem separada (`pixels/routes.ts:20-21` via helper `find`; `broadcasts/routes.ts:113,131`; `kanban/service.ts:22,46`; `channel-flow-settings/routes.ts:43`). Amostragem apenas; não auditei as ~19 rotas linha a linha. Item 4 do "próximo corte" em `docs/STATUS.md` (testes de isolamento) continua aberto; nenhum teste com nome tenant/isolamento (`grep -rniE "tenant|isolation|isolamento" apps/api/src --include=*.test.ts` vazio). Esforço: M (suíte que cria 2 workspaces e bate em todas as rotas por id alheio).

### P1-5. Autenticação: usa só a primeira membership, refresh sem detecção de reuso
- Evidência: `auth/routes.ts:4` e `:5` (`user.memberships[0]` sem seleção de workspace; sem ordenação explícita). Refresh rotaciona (revoga o antigo), mas reapresentar um token revogado só devolve 401, sem revogar a família. `authenticate` consulta a membership no banco a cada request (`core/security.ts:10`), ok para revogação mas custo por request. `/v1/auth/logout` revoga só o refresh enviado. Esforço: M.

### P1-6. Observabilidade limitada ao log
- Evidência: API usa logger Fastify com redaction (`apps/api/src/app.ts`) e request-id; runtime usa `pino`. Sem métricas, tracing nem Sentry (`grep pino|metrics|sentry|prom-client|opentelemetry apps/*/package.json` só acha pino no runtime). `/health` e `/ready` existem (`health/routes.ts`); `ready` não checa o runtime nem filas BullMQ. Sem alerta para canal WhatsApp desconectado ou fila parada (não encontrado). Esforço: M.

### P1-7. Sem lint, formatação nem cobertura; CI sem gates de segurança
- Evidência: não existe config ESLint/Prettier; `package.json` raiz sem script `lint`/`format`; `.github/workflows/ci.yml` só roda typecheck, test, build e e2e. Sem `npm audit`, sem relatório de cobertura (`coverage/` só no .gitignore), sem dependabot (arquivo ausente em `.github/`). Código da API está em linhas muito longas e minificadas à mão (ex.: `apps/api/src/app.ts` com tudo em 2 linhas; `auth/routes.ts`), o que dificulta revisão. Esforço: M.

### P1-8. Testes: forte em unidades, fraco em jornada e web
- Evidência: 64 arquivos de teste em apps/ (a maioria em API/runtime: domínio, compiler, fluxos), mas só ~10 no web (lógica de `flow-draft`, `simulator`, etc.) e 1 spec E2E (`e2e/app.spec.ts`). Nenhum teste de componente React. `docs/STATUS.md` cita "49 testes" (desatualizado). Rotas de auth, workspaces, contacts, billing, knowledge, webhooks/meta e analytics sem teste de rota (somente `billing/service.test.ts`, `analytics/metrics.test.ts`). Esforço: G.
- Não verificado: números reais de testes/cobertura (não rodei `npm test`).

### P1-9. Riscos do Baileys (WhatsApp não oficial)
- Evidência: `apps/runtime/package.json` usa `@whiskeysockets/baileys ^6.7.19` (range caret em lib não oficial; quebra com mudanças do WhatsApp Web); `docs/STATUS.md` admite ausência de garantia contra bloqueio e que o E2E com número real e reconexão ainda não foi medido (item 1 do próximo corte). `session-manager.service.ts:55` usa `Browsers.ubuntu('Zuno Flow')`. Disparos em massa (`broadcasts`) aumentam o risco de banimento: há intervalo aleatório, cota diária e checagem de consentimento/opt-out (`broadcasts/routes.ts:17,60,76-80`), mas não há aviso de risco na UI (não verifiquei) nem aquecimento de número. Meta Cloud API adapter não existe (item 5 do próximo corte). Esforço: G (adapter oficial); P (fixar versão exata do Baileys, runbook de reconexão/QR).

### P1-10. Deploy sem rollback e sem migração segura
- Evidência: `.github/workflows/deploy.yml`: `git checkout --detach`, `npm ci`, `db:deploy`, `build`, `pm2 startOrReload`, health check de 6 tentativas. Sem backup antes da migração, sem rollback automático se o health falhar, sem `--force`-guard. Migrações são só "para frente" (21 migrations, sem down). `ecosystem.config.cjs` limita memória (512M/768M) mas sem política de logs. Positivo: `environment: production` com aprovação, `permissions: contents: read`. Esforço: M.

## P2 (melhorias)

- P2-1. Seed com senha fixa pública (`apps/api/prisma/seed.ts:4`) e README com login de dev (`README.md`): garantir que o seed não rode em produção (não há guarda de `NODE_ENV` no trecho lido). Esforço: P.
- P2-2. CORS: origem única via `WEB_ORIGIN` com fallback `http://localhost:5173` (`app.ts`); em produção sem a variável cai em localhost. A config `packages/config/src/index.ts` valida `JWT_SECRET` (min 32), mas não confirmei se a API a usa na subida (`security.ts:7` lê `process.env.JWT_SECRET!` direto). Rota de importação Leona abre CORS para `https://app.leonasolutions.io` (`imports/routes.ts:131-132`, intencional, protegida por código + rate limit). Esforço: P.
- P2-3. Acessibilidade web: ~120 ocorrências de `aria-`/`role=` e só 2 de `alt=` nos `.tsx`; não há ErrorBoundary (grep vazio), nem `public/` (favicon/manifest). Foco/contraste/teclado no editor de fluxos e Kanban não verificados (precisaria rodar a UI). Esforço: M. (Task 02 cobre parte.)
- P2-4. Web: token de sessão e rascunho em `localStorage` (`shared/auth/session-storage.ts`, `flow-draft.ts`); aceitável, mas exposto a XSS; sem CSP (ver P1-1). Esforço: M (cookie httpOnly) ou aceitar o risco.
- P2-5. DX: `README.md` curto (42 linhas) sem seção de variáveis, troubleshooting, testes ou e2e; nome ainda "Nexo" no README e nos pacotes `@nexo/*` (renome é da task 01). `docs/STATUS.md` desatualizado (contagem de testes, audit, Kanban/Disparos aparecem como "fora do corte" mas já existem no código). Muitos documentos de paridade Leona na pasta `docs/` sem índice. Esforço: P.
- P2-6. Sem `.dockerignore`/Dockerfile de app (deploy é PM2 em VPS; compose só para dados); `infra/docker-compose.yml` usa senha `nexo/nexo` e portas 5432/6379 expostas em todas as interfaces (ok para dev, não usar em VPS). Esforço: P.
- P2-7. Redis: `/ready` checa Redis, mas não há política de `maxmemory`/persistência documentada para produção; filas BullMQ (`apps/runtime/src/queues.ts`) com retries/backoff não verificados. Esforço: P.
- P2-8. Tutoriais: não existe módulo/rota (`App.tsx` sem rota de tutoriais; grep por "tutorial" no web só em `SettingsPage`/`PlaybookEditorPage`). Esforço: M/G conforme escopo.

## Itens parciais (estado real)

| Item | Estado observado | Evidência |
|------|------------------|-----------|
| Kanban | Existe: modelos, rotas, serviço, compilador, testes de API, página web com rota `/kanban`. STATUS.md ainda o lista como pendente (doc desatualizado). Cobertura de UI/E2E não verificada. | `schema.prisma:918-973`, `apps/api/src/modules/kanban/*`, `apps/web/src/features/kanban/` |
| Disparos em massa | Existe: modelo `Broadcast`/`BroadcastRecipient`, rotas com consentimento, opt-out, cota diária, intervalo; página `/broadcasts`. Sem teste de rota (nenhum `*.test.ts` em `broadcasts/`). Risco de banimento (P1-9). | `schema.prisma:847-871`, `broadcasts/routes.ts` |
| Meta Ads | Parcial: apenas Pixels Meta (`MetaPixel`, evento de teste) e webhook Meta de mensagens. Não há integração de Facebook/Meta Ads (campanhas, leads) nem tela própria. | `schema.prisma:1036`, `pixels/routes.ts` |
| Tutoriais | Ausente. | P2-8 |
| Billing | Leitura e quotas ok; checkout/portal retornam 503 fixo ("adapter não habilitado"). | `billing/routes.ts:7-8` |
| Retrieval vetorial | Não verificado (indexação existe em `knowledge-indexer.service.ts`; não confirmei se há uso de pgvector na consulta). STATUS.md o lista como pendente. | `docs/STATUS.md` |

## O que não foi possível verificar
- Comportamento em execução (build, testes, E2E, UI, prints): proibido nesta task.
- Contagem real de testes e cobertura.
- Isolamento de tenant rota a rota (apenas amostra).
- Conteúdo de `.env` (não lido por regra); apenas nomes de variáveis em `.env.example`.
- Configuração real do servidor de produção (TLS, firewall, backups no VPS, secrets do GitHub).
- Estabilidade/reconexão do Baileys com número real.
- Alcance real dos advisories do `npm audit`.
- Qualidade a11y/contraste/foco da UI e responsividade.
- Nota: o repositório está com arquivos modificados e não commitados (inclui `apps/api/src/app.ts`, `core/security.ts`, `imports/routes.ts`, runtime); a revisão reflete a árvore de trabalho no momento da leitura, que pode mudar.
