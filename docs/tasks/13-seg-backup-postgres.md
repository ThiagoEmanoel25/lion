# 13 Backup e restore do Postgres (e nota sobre Redis)
Status: pendente
Origem: P0-4 em `docs/REVISAO.md`
Esforço estimado: P a M

## Arquivos
novo scripts/backup-postgres.sh e scripts/restore-postgres.sh, docs/DEPLOY-VPS.md (seção Backup), possível cron/systemd timer documentado

## Escopo
Script de `pg_dump -Fc` com retenção configurável (ex.: 14 dias), saída em diretório fora do repositório, permissões 600, sem senha na linha de comando (usar `PGPASSFILE`/env); script de restore com confirmação explícita e alvo informado; documentar agendamento diário, cópia off-site (a escolher pelo dono), e o fato de que as credenciais do Baileys estão no banco (perder o banco derruba todas as sessões WhatsApp); documentar política mínima de Redis (persistência AOF, `maxmemory`).

## Critérios de aceite
Em containers temporários: criar dados com seed, rodar backup, derrubar o banco, restaurar e confirmar que login e contatos voltam; documentação com passo a passo e teste de restore recorrente.

## Regras
Regras comuns: ler `docs/REVISAO.md` (item citado) antes de editar; mudança mínima e completa; rodar `npm run typecheck`, `npm test` e `npm run build`; se tocar o frontend, rodar `npm run test:e2e` e conferir os prints (desktop e mobile). Proibido: commit, push, deploy, credenciais reais; banco/Redis de teste só em containers temporários (portas 55432/56379), removidos no fim.
