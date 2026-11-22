# 10 Rate limit e lockout em login, refresh e convites
Status: pendente
Origem: P0-1 em `docs/REVISAO.md`
Esforço estimado: M

## Arquivos
apps/api/src/modules/auth/routes.ts, apps/api/src/modules/workspaces/routes.ts (/v1/invitations/accept), apps/api/src/app.ts, apps/api/package.json, testes novos em apps/api/src/modules/auth/

## Escopo
Adicionar `@fastify/rate-limit` (usar o Redis já existente como store) com limite por IP e por e-mail em `/v1/auth/login`, `/v1/auth/refresh` e `/v1/invitations/accept`; lockout temporário após N falhas por e-mail (sem revelar se o e-mail existe); resposta 429 com `retry-after` e código estável; logar tentativa bloqueada em `warn` sem vazar a senha; limites configuráveis por env (com defaults seguros) e documentados em `.env.production.example`.

## Critérios de aceite
Teste de API: N+1 logins errados retorna 429; login correto após a janela volta a funcionar; refresh e convite também limitados; E2E existente continua verde (login válido e inválido).

## Regras
Regras comuns: ler `docs/REVISAO.md` (item citado) antes de editar; mudança mínima e completa; rodar `npm run typecheck`, `npm test` e `npm run build`; se tocar o frontend, rodar `npm run test:e2e` e conferir os prints (desktop e mobile). Proibido: commit, push, deploy, credenciais reais; banco/Redis de teste só em containers temporários (portas 55432/56379), removidos no fim.
