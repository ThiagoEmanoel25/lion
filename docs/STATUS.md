# Estado da implementação

## Implementado

- Monorepo com aplicação web, API e pacotes compartilhados.
- Modelo PostgreSQL multi-tenant com 24 entidades e índices de isolamento/consulta.
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
- Dados de demonstração quando a API ainda não está conectada.

## Verificado

- Prisma Client gerado com sucesso.
- Typecheck da API e do web aprovado.
- Build de produção da API e do web aprovado.
- 20 testes automatizados aprovados entre API, compilador de fluxos, runtime, criptografia, normalização de mensagens e web.
- `npm audit --omit=dev`: zero vulnerabilidades de produção.

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
3. Concluir a migração das telas restantes para as queries modulares da API.
4. Adicionar testes de isolamento entre tenants e da jornada completa.
5. Implementar adapter Meta Cloud API antes de clientes que exijam SLA oficial.
