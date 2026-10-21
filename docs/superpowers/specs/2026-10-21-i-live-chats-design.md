# I — Chats ao vivo no padrão operacional do Leona

Data: 21/10/2026  
Roadmap: item 1.2 · Depende de H para identificar o canal e disparar encerramentos.

## Objetivo

Transformar o inbox atual em uma fila operacional: o atendente deve enxergar o estado de cada conversa, mover o atendimento pela lista, iniciar conversas e agendar mensagens sem abrir telas auxiliares.

## Estados e filtros

- **Aguardando**: `NEW`, `AUTOMATED`, `WAITING_CUSTOMER` ou `QUEUED`.
- **Atendendo**: `ASSIGNED`.
- **Resolvidos**: `RESOLVED`.
- Cada aba devolve contador independente, calculado no banco e não só sobre a página carregada.
- Filtros rápidos:
  - Tudo;
  - Não lidas: `unreadCount > 0`;
  - Não respondidas: `lastInboundAt > lastOutboundAt` ou ausência de saída.
- Abrir a conversa marca como lida. Hover, pré-visualização e paginação não alteram leitura.

## Dados

- `Conversation.lastInboundAt DateTime?` e `lastOutboundAt DateTime?`.
- Backfill a partir das mensagens mais recentes de cada direção.
- Toda persistência de mensagem atualiza o campo correspondente na mesma transação.
- `ScheduledMessage`: `id`, `workspaceId`, `conversationId`, `authorId`, `body`, `scheduledFor`, `status`, `jobId?`, `sentMessageId?`, `error?`, timestamps.
- Status: `PENDING`, `PROCESSING`, `SENT`, `CANCELLED`, `FAILED`.
- Índices por `(workspaceId, status, scheduledFor)` e `(conversationId, status, scheduledFor)`.

## API

- `GET /v1/conversations?bucket=&attention=&channelId=&search=` retorna página e `counts` das três abas.
- `POST /v1/conversations`: `{channelId, phone, name?}`; normaliza o telefone, reaproveita contato/conversa aberta ou cria uma nova.
- `POST /v1/conversations/:id/transition`: `{direction:'back'|'forward'}`; transição permitida por papel e estado atual.
- `GET /v1/conversations/:id/scheduled-messages`.
- `POST /v1/conversations/:id/scheduled-messages`: `{body, scheduledFor}`.
- `DELETE /v1/scheduled-messages/:id`: só cancela `PENDING`.
- Todas as leituras e escritas filtram `workspaceId`; mudanças ficam na auditoria.

## Agendamento

1. API cria `ScheduledMessage` e job BullMQ com `jobId` persistido.
2. O job reivindica a linha por `updateMany(status=PENDING)` para impedir envio duplo.
3. Cria `Message` e `message.send.requested` na mesma transação.
4. Sucesso liga `sentMessageId`; erro definitivo marca `FAILED`.
5. Cancelamento remove o job quando possível, mas a trava no banco é a autoridade.

## Frontend

- Cabeçalho com as três abas e contadores.
- Linha do chat: canal, não lidas, última mensagem, horário e setas anterior/próximo.
- Botão **Criar novo chat** abre modal de canal, telefone e nome.
- Composer ganha **Enviar agora / Agendar envio**.
- Painel da conversa lista agendamentos, status e ação Cancelar.
- Atualização otimista somente para transições; falha restaura a linha.
- Responsivo em 390 e 768 px, sem marcar leitura ao navegar pela lista.

## Fora de escopo

- Agendar mídia, recorrência e campanhas em massa.
- SLA, distribuição automática de atendentes e presença em tempo real.

## Testes e aceite

- Testes puros da classificação das abas e de “não respondida”.
- API: isolamento, contadores, transições inválidas, criação idempotente e cancelamento.
- Worker: reivindicação concorrente envia uma única mensagem.
- Aceite: mover uma conversa da lista até Resolvidos, filtrar não lidas/não respondidas, criar um chat e receber uma mensagem agendada no horário.
