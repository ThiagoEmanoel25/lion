# 02 Base de design e UX
Status: feita
Objetivo: UI mais amigável e consistente sem reescrever telas.
Possui: `apps/web/src/styles.css`, `components/layout.css`, `components/Layout.tsx` (exceto bloco de marca), `shared/ui/*`, `features/auth/login.css`.
Escopo: tokens de design (cores, espaçamento, raio, tipografia, foco visível); `styles.css` legível (hoje é 1 linha minificada); `LoadingState` com skeleton; `EmptyState` com ícone + ação (CTA) opcional; `ErrorState` com mensagem humana; navegação mobile (menu hambúrguer/drawer, alvos de toque >= 44px); `aria-label`, foco por teclado, contraste AA; `prefers-reduced-motion`; toasts de sucesso/erro reutilizáveis se não existirem.
Não possui: páginas em `features/*` (isso é a 04) nem onboarding (03).
Aceite: typecheck/test/build verdes; prints desktop+mobile de login, inbox e uma tela vazia comparados antes/depois; sem regressão no E2E.
