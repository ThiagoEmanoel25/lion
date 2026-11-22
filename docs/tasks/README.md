# Plano: revisão, marca Zuno Flow, UI/UX e onboarding

Regras: um subagent por task; cada um só edita os arquivos que "possui"; o orquestrador revisa o diff antes de seguir.
Toda mudança de frontend: rodar `npm run typecheck -w @nexo/web`, `npm test -w @nexo/web` e `npm run test:e2e` (prints em `e2e/screenshots/`) e conferir os prints (desktop e mobile).
Proibido: commit, push, deploy, credenciais. Banco/Redis de teste: containers temporários em portas livres (ex.: 55432/56379), removidos no fim.

| # | Task | Status | Dono dos arquivos |
|---|------|--------|-------------------|
| 00 | Revisão do projeto (lacunas) | feita (docs/REVISAO.md) | `docs/REVISAO.md` |
| 01 | Renomear para Zuno Flow (texto visível) | feita (resta PlaybooksPage, na 04) | ver 01 |
| 02 | Base de design e UX (tokens, estados, mobile, a11y) | feita | ver 02 |
| 03 | Onboarding (boas-vindas + checklist) | feita | ver 03 |
| 04 | Polimento de telas (empty states, copy, confirmações) | feita (04a, 04b) | ver 04 |
| 05 | E2E Playwright + prints do que mudou | feita (10 testes, 33 prints) | `e2e/` |

Ordem: 00, 01, 02 e 03 em paralelo (arquivos disjuntos) -> 04 -> 05.
