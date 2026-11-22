# 17 Autenticação: escolha de workspace e detecção de reuso de refresh
Status: pendente
Origem: P1-5 em `docs/REVISAO.md`
Esforço estimado: M

## Arquivos
apps/api/src/modules/auth/routes.ts, apps/api/src/core/security.ts, schema Prisma se necessário (migração), contratos em packages/contracts, frontend só se a escolha de workspace exigir tela

## Escopo
Login com mais de uma membership: aceitar `workspaceId` opcional e ordenar de forma determinística; reuso de refresh token revogado revoga toda a família/sessão e loga evento de segurança (`audit`); logout revoga as sessões do dispositivo; avaliar cache curto da membership em `authenticate` (custo por request).

## Critérios de aceite
Testes: reuso de refresh derruba a sessão; usuário com 2 workspaces entra no escolhido; contratos e frontend compatíveis (typecheck, E2E de login verdes).

## Regras
Regras comuns: ler `docs/REVISAO.md` (item citado) antes de editar; mudança mínima e completa; rodar `npm run typecheck`, `npm test` e `npm run build`; se tocar o frontend, rodar `npm run test:e2e` e conferir os prints (desktop e mobile). Proibido: commit, push, deploy, credenciais reais; banco/Redis de teste só em containers temporários (portas 55432/56379), removidos no fim.
