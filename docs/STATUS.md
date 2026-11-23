# Estado da implementação

## Implementado

- Monorepo com aplicação web, API e pacotes compartilhados.
- Modelo PostgreSQL multi-tenant com isolamento por workspace e índices de consulta.
- Autenticação JWT, sessões revogáveis e RBAC server-side.
- Workspaces, membros, canais, contatos, inbox, mensagens, atribuição e handoff.
- Playbooks versionados, publicação explícita e trilha de execução.
- Runtime de IA com adapter, política de handoff e medição de custo.
- Fontes de conhecimento com indexação assíncrona via outbox.
- Webhook Meta com validação, idempotência e processamento desacoplado.
- Analytics, usage records, assinatura, auditoria e health checks.
- Interface React responsiva para dashboard, inbox, contatos, playbooks, conhecimento, resultados e configurações.
- Editor visual de fluxos com dez tipos de nó, condições, rota padrão, prioridades, validação, simulação, versões e publicação.
- Runtime NestJS/BullMQ isolado para sessões Baileys, envio e recebimento idempotentes.
- Credenciais e chaves Signal cifradas com AES-256-GCM e protegidas por lock distribuído por canal.
- Dashboard e Resultados alimentados por métricas reais, períodos de 7/30/90 dias e exportação CSV.
- Inbox real com busca, filtros, paginação, polling, atribuição, handoff, envio e timeline de execução.
- CRM de contatos com edição, responsável, etapas, etiquetas, campos personalizados e importação CSV validada.
- Login, refresh token e proteção das rotas do frontend conectados ao provedor de sessão atual.
- Agentes de IA configuráveis, teste controlado, fontes de conhecimento e handoff explícito quando o provedor está indisponível.
- Webhooks genéricos de entrada com HMAC, idempotência, rate limit, mapeamento, logs e replay.
- Configurações reais de workspace, equipe, convites, departamentos, horários e auditoria.
- Cobranças e assinaturas com plano, cotas, uso, projeção, histórico, CSV e enforcement server-side.

## Verificado

- Prisma Client gerado com sucesso.
- Typecheck dos três workspaces aprovado.
- Build de produção dos três workspaces aprovado.
- 538 testes automatizados aprovados (2026-11-22): 223 na API, 158 no runtime, 54 no web e 103 no domain.
- Smoke test autenticado aprovado nas 11 rotas principais em desktop e viewport móvel, sem erros de console ou HTTP.
- `npm audit --omit=dev` (2026-11-22): 1 vulnerabilidade high restante (zod 3.25.76, DoS de memória em coleções grandes, GHSA-mrhx-c7xc-m3w5), risco aceito (ver BOARD.md). Corrigidas: effect/prisma (override effect ^3.22.5, prisma 6.19.3), follow-redirects e fast-uri. Antes: 6 (5 high, 1 moderate).

## Ambiente local validado

- PostgreSQL com pgvector e Redis ativos via Docker Compose.
- Migração inicial aplicada com sucesso.
- Seed aplicado; autenticação real validada.
- `/health`, `/ready`, login e frontend verificados por HTTP.
- Build de produção da API iniciado e validado pela rota `/ready`.

## Dependências externas para operação real

- Um número WhatsApp dedicado ao piloto Baileys; a integração não é oficial e não oferece garantia contra bloqueios ou mudanças do WhatsApp Web.
- Chave do provedor de IA para substituir o adapter de desenvolvimento.
- Provedor de billing apenas quando a cobrança for ativada.

## Próximo corte de engenharia

1. Executar testes E2E com um número WhatsApp dedicado e medir estabilidade/reconexão.
2. Adicionar retrieval vetorial e ingestão de documentos ao nó de agente.
3. Implementar os módulos ainda fora do corte: Kanban, disparos em massa, Facebook/Meta Ads e tutoriais.
4. Adicionar testes de isolamento entre tenants e da jornada completa.
5. Implementar adapter Meta Cloud API antes de clientes que exijam SLA oficial.
