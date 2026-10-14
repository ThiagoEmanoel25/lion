# API do MVP

Todas as rotas, exceto autenticação, health e webhook, exigem `Authorization: Bearer <token>`.

## Auth e tenant

- `POST /v1/auth/login`
- `POST /v1/auth/logout`
- `GET /v1/auth/me`
- `GET|PATCH /v1/workspace`

## Operação

- `GET|POST /v1/channels`
- `POST /v1/channels/whatsapp/sessions` — cria canal Baileys e agenda conexão por QR ou pairing code.
- `GET /v1/channels/:id/session` — estado transitório autenticado da sessão (QR expira em cinco minutos).
- `POST /v1/channels/:id/connect`
- `POST /v1/channels/:id/automation` — associa ou remove um playbook publicado do canal.
- `POST /v1/channels/:id/disconnect`
- `GET|POST /v1/contacts`
- `GET /v1/conversations`
- `GET /v1/conversations/:id`
- `POST /v1/conversations/:id/messages`
- `POST /v1/conversations/:id/assign`
- `POST /v1/conversations/:id/mode`

## Automação e IA

- `GET|POST /v1/playbooks`
- `GET /v1/playbooks/:id`
- `POST /v1/playbooks/:id/versions` — salva uma versão imutável com controle otimista.
- `POST /v1/playbooks/:id/validate`
- `POST /v1/playbooks/:id/simulate`
- `POST /v1/playbooks/:id/publish`
- `POST|GET /v1/playbooks/:id/executions`
- `GET /v1/executions/:executionId`
- `POST /v1/executions/:executionId/cancel`
- `POST /v1/ai/simulate`
- `GET|POST /v1/knowledge/sources`
- `DELETE /v1/knowledge/sources/:id`

## Métricas e cobrança

- `GET /v1/analytics/overview`
- `GET /v1/billing/usage`

## Integração externa

- `GET /v1/webhooks/meta` — verificação do endpoint.
- `POST /v1/webhooks/meta` — recebimento idempotente.
- `GET /health` — liveness sem detalhes internos.
- `GET /ready` — readiness para infraestrutura, não deve ser público.

Erros seguem `{ code, message, requestId, details? }`.
