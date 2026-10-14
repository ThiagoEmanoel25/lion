# Arquitetura do sistema

## Fronteiras de domínio

| Módulo | Dono dos dados | Pode depender de |
| --- | --- | --- |
| auth | sessão, credencial | workspaces |
| workspaces | tenant, membros, papéis | auth |
| channels | números, sessões e credenciais criptografadas | workspaces |
| contacts | contato, tags e funil | workspaces |
| inbox | conversas e mensagens | contacts, channels |
| playbooks | definição, versões e execuções | inbox, contacts |
| ai | modelos, ferramentas, uso e políticas | playbooks, knowledge |
| knowledge | fontes e trechos | workspaces |
| analytics | eventos e projeções | eventos dos demais módulos |
| billing | assinatura, cotas e medição | workspaces, analytics |
| webhooks | ingestão externa e idempotência | channels, inbox |

Módulos não acessam tabelas de outros módulos por atalhos. Comunicação síncrona usa serviços públicos; efeitos assíncronos usam eventos persistidos e outbox.

## Processos

- `apps/api` é o plano de controle HTTP: autenticação, configuração, versões e comandos.
- `apps/runtime` é o plano de execução NestJS: mantém sockets Baileys e consome filas BullMQ.
- PostgreSQL é a fonte de verdade; Redis coordena filas, locks e estado transitório de conexão.
- Cada canal possui no máximo um socket ativo, protegido por lock distribuído com renovação.

## Fluxo de uma mensagem

```text
Baileys messages.upsert → fila whatsapp.inbound → normalização/idempotência
     → Conversation + Message → fila automation.execute
     → motor do fluxo → mensagem, espera, condição, ação ou handoff
     → fila whatsapp.outbound → socket Baileys
```

O request do webhook apenas valida, persiste e confirma. IA e envio nunca bloqueiam a resposta para a Meta.

## Garantias

- Toda entidade de negócio contém `workspaceId`.
- Repositórios exigem `TenantContext`; não aceitam tenant opcional.
- `externalId` e eventos de entrada têm restrições únicas de idempotência.
- Mensagens de uma conversa são processadas serialmente.
- Uma execução fixa `playbookVersionId` até terminar.
- Credenciais e chaves Signal são persistidas com AES-256-GCM e nunca aparecem em logs, eventos ou respostas da API.
- A atualização das chaves Signal é durável antes de concluir cada operação do key store.
- Acesso de suporte é temporário, consentido e auditado.

## Limite do provedor WhatsApp

O runtime usa Baileys no piloto por decisão de produto. A integração é não oficial e pode quebrar quando o WhatsApp Web mudar ou resultar em restrições da conta. O restante do domínio não importa tipos do Baileys: conexão, recebimento e envio passam por comandos/eventos internos para permitir um adapter Meta Cloud API posteriormente.
