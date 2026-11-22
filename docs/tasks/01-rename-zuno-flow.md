# 01 Renomear para Zuno Flow
Status: feita
Objetivo: texto visível ao usuário passa de "Nexo" para "Zuno Flow" usando `APP_NAME`/`APP_TAGLINE` de `apps/web/src/shared/brand.ts`.
Possui: `apps/web/index.html`, `components/Layout.tsx` (só o bloco de marca), `features/auth/LoginPage.tsx` (só textos), `README.md`, `docs/*.md` (menções de produto), `apps/runtime/src/whatsapp/session-manager.service.ts` (`Browsers.ubuntu`), texto do prompt em `apps/api/src/modules/imports/routes.ts:112`, `infra/nginx/nexo.conf` comentários, `.env.production.example` comentários, `e2e/app.spec.ts` (heading do login).
NÃO mudar: chaves localStorage, `@nexo/*`, `nexo-asset://`, fonte 'nexo', rotas/API, `admin@nexo.local`, nomes de processos PM2 (`nexo-api`/`nexo-runtime`).
Aceite: `grep -rni "nexo"` nos textos visíveis não acha a marca antiga; typecheck/testes/build verdes; print do login e do menu conferido.
