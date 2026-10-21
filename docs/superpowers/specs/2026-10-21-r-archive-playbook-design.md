# R — Arquivar e desarquivar fluxo

Data: 21/10/2026  
Roadmap: item 2.7.

## Objetivo

Completar o ciclo de vida já previsto pelo enum `ARCHIVED`, retirando fluxos antigos das listas e impedindo novas execuções.

## Dados e estados

- Adicionar `Playbook.archivedAt?`.
- Transições permitidas: `DRAFT|PAUSED|PUBLISHED -> ARCHIVED` e `ARCHIVED -> DRAFT`.
- Desarquivar sempre volta para Rascunho; exige validar/publicar novamente.
- Histórico de versões permanece intacto.

## Dependências antes de arquivar

API retorna usos ativos:

- slots e palavras-chave de canais;
- inbound webhooks;
- Conexão de Fluxo em versões ativas, detectada pela definição JSON;
- qualquer execução RUNNING/WAITING.

Execuções ativas bloqueiam com `409`. Outros usos exigem `{confirmDetach:true}`; a transação remove configurações diretas e registra no audit. Flow jumps não são reescritos: passam a aparecer inválidos no fluxo de origem.

## API

- `GET /v1/playbooks/:id/archive-impact`.
- `POST /v1/playbooks/:id/archive`.
- `POST /v1/playbooks/:id/unarchive`.
- Arquivado não pode ser publicado, pausado, destino de jump, webhook, slot ou palavra-chave.

## Frontend

- Menu ⋯ ganha Arquivar; modal lista impactos antes da confirmação.
- Filtro **Arquivados** separado; Todos não inclui arquivados.
- Editor arquivado é somente leitura, com banner e botão Desarquivar.
- Duplicar/compartilhar pode criar um novo rascunho, sem reativar o original.

## Runtime

- Seletores de destino filtram arquivados.
- Worker recusa iniciar novas execuções; uma execução já iniciada precisa ser resolvida antes do arquivamento.

## Testes e aceite

- Matriz de transições, impacto e remoção confirmada.
- Nenhum endpoint consegue usar fluxo arquivado como destino.
- Aceite: arquivar retira de Todos, abre somente leitura e desarquivar cria estado Rascunho preservando versões.
