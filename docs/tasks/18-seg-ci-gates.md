# 18 Gates de segurança e qualidade no CI
Status: pendente
Origem: P1-7 em `docs/REVISAO.md`
Esforço estimado: M

## Arquivos
package.json, .github/workflows/ci.yml, novo .github/dependabot.yml, configs ESLint/Prettier (mínimas)

## Escopo
Job de `npm audit --omit=dev --audit-level=high` (falha em high/critical); Dependabot semanal (npm e actions); ESLint mínimo com `@typescript-eslint` e regras de segurança (sem reescrever o código existente: começar só com `no-floating-promises`, `no-unused-vars`, `eqeqeq` e `no-eval`, aceitando warnings legados); relatório de cobertura (vitest `--coverage`) publicado como artefato; `permissions` mínimas e actions fixadas por versão.

## Critérios de aceite
CI verde no estado atual (workflow validado por `actionlint` em container temporário); `npm run lint` existe e passa; sem refatoração em massa do código.

## Regras
Regras comuns: ler `docs/REVISAO.md` (item citado) antes de editar; mudança mínima e completa; rodar `npm run typecheck`, `npm test` e `npm run build`; se tocar o frontend, rodar `npm run test:e2e` e conferir os prints (desktop e mobile). Proibido: commit, push, deploy, credenciais reais; banco/Redis de teste só em containers temporários (portas 55432/56379), removidos no fim.
