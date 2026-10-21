# T — Bloco Venda aprovada

Data: 21/10/2026  
Roadmap: item 3.2 · Depende de S e U.

## Objetivo

Registrar uma venda a partir do fluxo, usando produto, dados do pagador e valor extraído do comprovante, com idempotência e notificação interna.

## Dados

`Sale`:

- `id`, `workspaceId`, `productId`, `contactId`, `conversationId?`, `sourceExecutionId?`, `sourceNodeId?`;
- `customerName`, `valueCents`, `currency`, `source` (`FLOW`, `MANUAL`, `IMPORT`), `metadata`, `occurredAt`, timestamps;
- único por `(sourceExecutionId, sourceNodeId)` quando originada por fluxo.

`WorkspaceNotification`:

- `id`, `workspaceId`, `type`, `title`, `subtitle`, `entityType`, `entityId`, `readAt?`, timestamps.

## Bloco

Novo kind `approved_sale`, terminal por padrão.

Config:

- `productId` obrigatório;
- `customerName`: padrão `{{comprovante.nome_pagador}}`;
- `value`: padrão `{{comprovante.valor}}`;
- `currency?`: vazio usa produto;
- `notificationTitle` e `notificationSubtitle` aceitam variáveis.

## Runtime

1. Resolver produto ativo do mesmo workspace.
2. Renderizar nome, valor e moeda.
3. Parser monetário aceita centavos numéricos e formatos `1234.56`/`1.234,56`, com regra explícita por locale.
4. Aplicar `resolveProductPrice`; guardar candidato e motivo de fallback em metadata.
5. Na mesma transação criar `Sale`, `Outcome(SALE)`, notificação e concluir execução.
6. Reprocessamento devolve a venda existente e não duplica faturamento.

Produto inativo após publicação provoca falha clara; não usar valor de outro produto.

## Editor e canvas

- Select de produto ativo e ação **+ Criar produto** em nova aba/modal.
- Campos de nome, valor, moeda, título e subtítulo com seletor `<>`.
- Preview: produto, valor configurado e moeda.
- Modal explica a faixa e o fallback do produto escolhido.

## API auxiliar

- `GET /v1/sales/:id` e listagem entram na spec V.
- Notificações: listagem, marcar como lida e contador no topo.

## Importador

- `approved_sale` entra como pendência até o usuário vincular um produto local.
- Preservar nome do produto Leona como `sourceProductName` para facilitar seleção.

## Testes e aceite

- Parser monetário, faixa, fallback, moeda divergente e idempotência.
- Compiler recusa produto inexistente/inativo.
- Aceite: comprovante de R$ 150 dentro da faixa cria uma única venda, outcome e notificação com R$ 150.
