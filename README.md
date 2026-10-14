# Nexo

Plataforma multi-tenant de atendimento e vendas pelo WhatsApp com IA, inbox humana, playbooks versionados e observabilidade de execução.

## Estrutura

```text
apps/api       API HTTP, webhook gateway e workers
apps/runtime   Runtime NestJS para WhatsApp e execução assíncrona
apps/web       Aplicação React para operadores e gestores
packages       Contratos, domínio e configuração compartilhados
infra          PostgreSQL, Redis e serviços locais
docs           Decisões técnicas e documentação operacional
```

## Desenvolvimento

1. Copie `.env.example` para `.env` e ajuste os segredos.
2. Execute `docker compose -f infra/docker-compose.yml up -d`.
3. Execute `npm install`.
4. Execute `npm run db:generate && npm run db:migrate && npm run db:seed`.
5. Execute `npm run dev`.

Web: `http://localhost:5173` · API: `http://localhost:3333` · Health: `http://localhost:3333/health`

Login de desenvolvimento após o seed: `admin@nexo.local` / `NexoDemo2026!`.

Para validar a instalação:

```bash
npm run typecheck
npm test
npm run build
curl http://localhost:3333/health
curl http://localhost:3333/ready
```

Em ambientes já provisionados use `npm run db:deploy`; `db:migrate` é reservado ao desenvolvimento de novas migrações.

O canal padrão do piloto usa Baileys em um runtime isolado com Redis/BullMQ. Baileys é uma integração não oficial com o WhatsApp Web e não elimina risco de bloqueio da conta; o limite de provedor mantém aberta a migração para a Cloud API oficial. Sem uma chave OpenAI, os agentes fazem handoff explícito. Stripe ainda não possui adapter comercial e nenhuma cobrança é simulada.

O smoke test navegável está em `scripts/navigation-smoke.mjs`. Ele usa Chrome via CDP e pressupõe API e web locais ativos; por padrão valida desktop e aceita `VIEWPORT_WIDTH`/`VIEWPORT_HEIGHT` para conferir responsividade.
