# Quadro de tasks

Regra: uma task só vira `feita` com **prova** (comando + resultado, ou print) rodada pelo orquestrador, não pelo relatório do subagent. Detalhe técnico vai no prompt do subagent; aqui só o essencial. Contexto das lacunas: `../REVISAO.md`.

## Fase 1 (frontend): todas feitas
Prova: typecheck 0 erros, 527 testes unitários, `npm run test:e2e` = 10 passed, 33 prints em `e2e/screenshots/`.

| # | Task | Status |
|---|---|---|
| 00 | Revisão do projeto (`docs/REVISAO.md`) | feita |
| 01 | Marca Zuno Flow (texto visível) | feita |
| 02 | Base de design e UX | feita |
| 03 | Onboarding | feita |
| 04 | Polimento das telas | feita |
| 05 | E2E e prints | feita |

## Fase 2 (segurança): pendente

| # | Task | Prioridade | Prova exigida para marcar `feita` |
|---|---|---|---|
| 10 | Rate limit e lockout em login, refresh e convite (`auth/routes.ts`, `workspaces/routes.ts`) | P0 | Teste de API: N+1 logins errados dá 429; login certo volta após a janela |
| 11 | Webhook Meta falha fechado em produção; HMAC sobre corpo bruto (`webhooks/routes.ts:46`) | P0 | Testes: assinatura válida passa, inválida 401, ausente em produção recusa |
| 12 | Corrigir `npm audit`; STATUS.md com número real | P0 | `npm audit --omit=dev` sem high/critical; testes e build verdes |
| 13 | Backup e restore do Postgres (scripts + doc) | P0 | Em container temporário: backup, apagar, restaurar, login e contatos voltam |
| 14 | Headers de segurança (helmet + Nginx) e TLS | P1 | `curl -I` mostra os headers; `nginx -t`; E2E sem erro de CSP |
| 15 | Assets: lista de MIME permitidos, download seguro | P1 | Teste: HTML/SVG não executa na origem da API |
| 16 | Testes de isolamento entre workspaces | P1 | Suíte nova verde com 2 workspaces; falhas achadas, corrigidas |
| 17 | Refresh: detectar reuso; escolher workspace no login | P1 | Teste: reuso derruba a sessão |
| 18 | CI: `npm audit`, lint mínimo, cobertura, Dependabot | P1 | Workflow válido (`actionlint`); `npm run lint` passa |
| 19 | Deploy: backup antes de migrar e rollback (depende da 13) | P1 | Simulação com rollback ao falhar o health; nenhum deploy real |
| 20 | Config e seed fail-closed; CORS | P2 | Teste: API não sobe sem segredos em produção; seed recusa em produção |

Paralelizáveis (arquivos disjuntos): 10, 11, 12, 13, 15. A 16 se divide por módulo.
