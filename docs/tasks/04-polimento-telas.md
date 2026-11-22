# 04 Polimento das telas
Status: em andamento (dividida em 04a e 04b, arquivos disjuntos)
04b feita.
Objetivo: aplicar os componentes da 02 nas telas principais.
Possui: `features/{inbox,contacts,playbooks,agents,knowledge,kanban,broadcasts,billing,settings,analytics,inbound-webhooks}/*` (só marcação/estilos/copy, sem mudar contratos da API).
Escopo: estados vazios com CTA, mensagens de erro humanas, confirmação em ações destrutivas, rótulos claros, loading consistente, responsividade mobile.
Aceite: typecheck/test/build verdes; E2E verde; prints antes/depois das telas alteradas.

## Pendência herdada da task 01
`features/playbooks/PlaybooksPage.tsx` ainda mostra a marca antiga em textos visíveis ("Código Nexo", "conta Nexo", "Exportar para o Nexo"): trocar por `APP_NAME`/"Zuno Flow" (sem mudar a fonte de importação `'nexo'` do contrato da API). Também comentários em `flow-builder.css` e `flow-draft.ts` (opcional).

## Divisão
- 04a: `features/{inbox,contacts,kanban,broadcasts,agents,knowledge}/*` — **04a feita** (typecheck e testes verdes; falta conferência visual no E2E).
- 04b: `features/{playbooks,billing,settings,analytics,inbound-webhooks}/*`, mais `components/layout.css`/`Layout.tsx` (estilo do link "Rever tutorial": alinhado aos demais itens do rodapé, sem espremer o card do plano), `features/auth/LoginPage.tsx`+`login.css` (mostrar logo/nome da marca no topo no mobile, onde o painel de marca some).
## API dos componentes (task 02)
`LoadingState({label?,lines?})`, `ErrorState({error,retry?,title?,retryLabel?})`, `EmptyState({title,children?,icon?,action?,actionLabel?,onAction?})`, `useToast()` -> `{success(msg),error(msg)}` (ToastProvider já está no Layout).
