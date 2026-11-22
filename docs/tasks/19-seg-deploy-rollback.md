# 19 Deploy: backup antes de migrar, rollback e health check
Status: pendente
Origem: P1-10 em `docs/REVISAO.md`
Esforço estimado: M

## Arquivos
dependências: task 13 (backup); .github/workflows/deploy.yml, novo scripts/deploy-remote.sh, docs/DEPLOY-VPS.md

## Escopo
No servidor: rodar o backup (task 13) antes de `db:deploy`; guardar o SHA anterior; se build ou health falhar, voltar ao SHA anterior e `pm2 reload`; health check também em `/api/ready`; documentar que migrações são só 'para frente' e como restaurar o backup em último caso; lock para evitar dois deploys simultâneos (já há `concurrency`).

## Critérios de aceite
Simulação em container/VPS descartável (ou `--dry-run` documentado) mostrando rollback quando o health falha; workflow validado por `actionlint`; NENHUM deploy real executado.

## Regras
Regras comuns: ler `docs/REVISAO.md` (item citado) antes de editar; mudança mínima e completa; rodar `npm run typecheck`, `npm test` e `npm run build`; se tocar o frontend, rodar `npm run test:e2e` e conferir os prints (desktop e mobile). Proibido: commit, push, deploy, credenciais reais; banco/Redis de teste só em containers temporários (portas 55432/56379), removidos no fim.
