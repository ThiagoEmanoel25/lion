# 16 Testes de isolamento entre workspaces (multi-tenant)
Status: pendente
Origem: P1-3 em `docs/REVISAO.md`
Esforço estimado: M a G (dividir por módulo em subagents)

## Arquivos
novos testes em apps/api (ex.: apps/api/src/core/tenant-isolation.test.ts), possível helper de fixtures com 2 workspaces

## Escopo
Auditar as rotas listadas em REVISAO (pixels, broadcasts, kanban/service, channel-flow-settings, contacts, inbox, playbooks, knowledge, assets, webhooks) procurando `update/delete/findUnique` por `id` sem `workspaceId`; escrever testes de API com 2 workspaces e 2 usuários provando que um não lê, altera nem apaga recursos do outro (esperado 404, nunca 403 com vazamento); corrigir cada falha encontrada com `where` composto ou `updateMany`/`deleteMany` com `workspaceId`; avaliar uma verificação automática (teste que varre as rotas registradas).

## Critérios de aceite
Suíte nova verde cobrindo todas as rotas com `:id`; relatório curto das falhas achadas e corrigidas em docs/REVISAO.md.

## Regras
Regras comuns: ler `docs/REVISAO.md` (item citado) antes de editar; mudança mínima e completa; rodar `npm run typecheck`, `npm test` e `npm run build`; se tocar o frontend, rodar `npm run test:e2e` e conferir os prints (desktop e mobile). Proibido: commit, push, deploy, credenciais reais; banco/Redis de teste só em containers temporários (portas 55432/56379), removidos no fim.
