# 03 Onboarding
Status: feita
Objetivo: guiar o primeiro uso, derivado de dados reais.
Possui: novo `apps/web/src/features/onboarding/*`, e UMA linha de montagem em `features/dashboard/DashboardPage.tsx` e rota/atalho no `app/App.tsx` se necessário.
Escopo: (1) modal de boas-vindas no primeiro acesso (3-4 passos curtos: o que é o Zuno Flow, inbox, fluxos, IA), com pular/voltar; (2) checklist "Primeiros passos" no dashboard com progresso calculado de dados reais via hooks/queries existentes (canal WhatsApp conectado, fluxo criado e publicado, contato ou conversa, chave de IA/agente configurado), cada item com botão para a tela certa; (3) dispensável e reabrível ("Rever tutorial" no menu/ajuda); (4) persistência por usuário+workspace em localStorage com chave nova `zuno.onboarding:<workspaceId>:<userId>` (try/catch, como `flow-draft.ts`); (5) acessível: foco preso no modal, Esc fecha, aria-modal; (6) textos em pt-BR usando `APP_NAME`.
Aceite: testes unitários (vitest) da lógica de progresso/persistência; E2E Playwright: primeiro login mostra boas-vindas, pular persiste, checklist aparece; prints desktop+mobile conferidos.
