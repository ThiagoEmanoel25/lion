# E — Kanban (quadro de etapas do lead + bloco)

Data: 15/10/2026 · Programa: paridade Leona (A → B → C → D → E)

## Objetivo

Atendentes acompanham leads num quadro de colunas (ex.: Novo → Comprovante enviado → Pago), e os fluxos criam ou movem o card do lead — o "Criar ou mover card no Kanban selecionado" da Leona.

## Modelo

- `KanbanBoard` (`workspaceId`, `name`, `position`)
- `KanbanColumn` (`boardId`, `name`, `color`, `position`)
- `KanbanCard` (`boardId`, `columnId`, `contactId`, `conversationId?`, `position`, `movedAt`, `movedBy` = usuário ou execução) — **um card por contato por quadro** (único `boardId + contactId`).
- `KanbanCardEvent` (card, de → para, quem, quando) para histórico.

## Tela (menu lateral → Operações → Kanban)

- Seletor de quadro; colunas horizontais com rolagem; cards com nome, telefone, etiquetas e tempo na coluna.
- Arrastar card entre colunas (HTML5 drag and drop, com alternativa por teclado: menu "Mover para…"); clicar abre a conversa.
- Criar/renomear/reordenar/excluir colunas e quadros (permissão `workspace.manage`); excluir coluna com cards exige escolher a coluna de destino.
- Atualização: refetch a cada 15 s (mesmo padrão das outras telas); sem tempo real nesta fase.

## Bloco Kanban

Config: `boardId`, `columnId`, `mode`: `create_or_move` (padrão) | `create_only` | `move_only`.
- `create_or_move`: cria o card do contato na coluna, ou move se já existir.
- `create_only` não move card existente; `move_only` não cria (segue normalmente se não houver card).
- Saída simples. Quadro/coluna excluídos: o compiler acusa erro; em execução, falha com motivo claro.

## Condição

Novo item no catálogo da Condicional, grupo **Atendimento**: "Coluna do Kanban" (`kanban.<boardId>.columnId`, operadores `in`/`not_in`), carregado no contexto ao vivo (spec das condições).

## Importador

Bloco `kanban` com ação da Leona → este bloco, casando quadro e coluna por nome (criados se não existirem, com pendência no relatório).

## Fora de escopo

Valores/funil financeiro por card, automações disparadas pela movimentação manual, tempo real por websocket.

## Testes

Unitários: regras de criar/mover por modo, unicidade por contato, exclusão de coluna com realocação; API: permissões e validação; editor: validação do bloco com quadro/coluna inexistentes.
