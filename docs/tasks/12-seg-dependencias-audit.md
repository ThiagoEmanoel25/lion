# 12 Corrigir vulnerabilidades do `npm audit` e atualizar STATUS.md
Status: pendente
Origem: P0-3 em `docs/REVISAO.md`
Esforço estimado: P a M

## Arquivos
package.json e package-lock.json (raiz e workspaces), docs/STATUS.md

## Escopo
Rodar `npm audit --omit=dev`; aplicar `npm audit fix` para `follow-redirects` e `fast-uri`; avaliar `zod` 3->4 (impacto nos schemas de `@nexo/contracts` e `@nexo/config`; só migrar se os testes cobrirem, senão documentar como risco aceito com mitigação) e `prisma`/`effect` (transitivo da CLI: atualizar para a versão corrigida compatível, rodar `db:generate` e migrações em banco temporário); corrigir a afirmação 'zero vulnerabilidades' em `docs/STATUS.md` com o resultado real.

## Critérios de aceite
`npm audit --omit=dev` sem high/critical (ou cada exceção justificada por escrito em docs/REVISAO.md); typecheck, 519+ testes e build verdes; migrações aplicam em banco temporário.

## Regras
Regras comuns: ler `docs/REVISAO.md` (item citado) antes de editar; mudança mínima e completa; rodar `npm run typecheck`, `npm test` e `npm run build`; se tocar o frontend, rodar `npm run test:e2e` e conferir os prints (desktop e mobile). Proibido: commit, push, deploy, credenciais reais; banco/Redis de teste só em containers temporários (portas 55432/56379), removidos no fim.
