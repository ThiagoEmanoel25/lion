# Segurança: tasks derivadas de docs/REVISAO.md

Cada task é autocontida para um subagent (um por task). Executar na ordem de prioridade; tasks de arquivos disjuntos podem rodar em paralelo (10, 11, 12, 13 e 15 são disjuntas; 19 depende da 13; 16 deve ser dividida por módulo). O orquestrador revisa o diff de cada uma antes de seguir. Nenhuma foi executada ainda.

| # | Item da revisão | Task | Esforço | Status |
|---|---|---|---|---|
| 10 | P0-1 | [Rate limit e lockout em login, refresh e convites](10-seg-rate-limit-auth.md) | M | pendente |
| 11 | P0-2 | [Webhook Meta: falhar fechado e validar sobre o corpo bruto](11-seg-webhook-meta-assinatura.md) | P | pendente |
| 12 | P0-3 | [Corrigir vulnerabilidades do `npm audit` e atualizar STATUS.md](12-seg-dependencias-audit.md) | P a M | pendente |
| 13 | P0-4 | [Backup e restore do Postgres (e nota sobre Redis)](13-seg-backup-postgres.md) | P a M | pendente |
| 14 | P1-1 | [Cabeçalhos de segurança e TLS](14-seg-headers-tls-nginx.md) | P a M | pendente |
| 15 | P1-2 | [Assets: allowlist de MIME e download seguro](15-seg-assets-mime.md) | P | pendente |
| 16 | P1-3 | [Testes de isolamento entre workspaces (multi-tenant)](16-seg-isolamento-tenant.md) | M a G (dividir por módulo em subagents) | pendente |
| 17 | P1-5 | [Autenticação: escolha de workspace e detecção de reuso de refresh](17-seg-auth-hardening.md) | M | pendente |
| 18 | P1-7 | [Gates de segurança e qualidade no CI](18-seg-ci-gates.md) | M | pendente |
| 19 | P1-10 | [Deploy: backup antes de migrar, rollback e health check](19-seg-deploy-rollback.md) | M | pendente |
| 20 | P2-1/P2-2 | [Config fail-closed, seed fora de produção e CORS](20-seg-config-seed-cors.md) | P | pendente |

Prioridade: P0 = 10, 11, 12, 13. P1 = 14 a 19. P2 = 20.
Não verificado na revisão: alcance real dos advisories do `npm audit` e isolamento de tenant rota a rota (a task 16 fecha essa lacuna).
