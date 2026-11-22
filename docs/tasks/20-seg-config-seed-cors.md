# 20 Config fail-closed, seed fora de produção e CORS
Status: pendente
Origem: P2-1/P2-2 em `docs/REVISAO.md`
Esforço estimado: P

## Arquivos
apps/api/src/server.ts, apps/api/src/core/security.ts, packages/config/src/index.ts, apps/api/prisma/seed.ts, apps/api/src/app.ts

## Escopo
Validar a configuração com `loadConfig()` na subida da API e do runtime (falhar com mensagem clara se faltar `JWT_SECRET`/`FIELD_ENCRYPTION_KEY`/`DATABASE_URL`); em produção exigir `WEB_ORIGIN` explícito (sem fallback para localhost) e `FIELD_ENCRYPTION_KEY` de 32 bytes; o seed recusa rodar com `NODE_ENV=production` (a menos de flag explícita); revisar o CORS aberto para `https://app.leonasolutions.io` na rota de importação (confirmar que é intencional e documentar).

## Critérios de aceite
Testes: API não sobe sem segredos em produção; seed recusa em produção; `.env.production.example` coerente.

## Regras
Regras comuns: ler `docs/REVISAO.md` (item citado) antes de editar; mudança mínima e completa; rodar `npm run typecheck`, `npm test` e `npm run build`; se tocar o frontend, rodar `npm run test:e2e` e conferir os prints (desktop e mobile). Proibido: commit, push, deploy, credenciais reais; banco/Redis de teste só em containers temporários (portas 55432/56379), removidos no fim.
