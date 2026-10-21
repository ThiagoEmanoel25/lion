# O — Controlador de Chat

Data: 21/10/2026  
Roadmap: item 2.4 · Usa os eventos de encerramento da spec H.

## Objetivo

Evoluir o Handoff para o bloco observado no Leona, capaz de colocar a conversa em Aguardando, Atendimento ou Resolvido.

## Compatibilidade

- Manter o kind `handoff` para versões existentes e importações antigas.
- Editor passa a chamá-lo **Controlador de Chat**.
- Config antiga `{queue, reason}` normaliza para `{state:'ATTENDING', queue, reason}`.

## Configuração

- `state`: `AWAITING`, `ATTENDING` ou `RESOLVED`.
- `departmentId?`, `assigneeId?`, `reason?` aparecem apenas em Atendimento.
- `returnToAi`: padrão `false`; opção avançada para Aguardando quando o fluxo deve seguir depois.

## Transições

- **Aguardando**: `mode='HUMAN'`, `status='QUEUED'`, limpa responsável quando não configurado.
- **Atendimento**: `mode='HUMAN'`, `status=assigneeId?'ASSIGNED':'QUEUED'`, define departamento/responsável.
- **Resolvido**: `status='RESOLVED'`, `resolvedAt=now`, `unreadCount=0` e dispara uma única vez `CONVERSATION_RESOLVED`.
- Sair de HUMAN por ação explícita dispara `HANDOFF_CLOSED`, como na spec H.
- O bloco é terminal por padrão. `returnToAi=true` só é permitido em Aguardando e expõe uma saída de sucesso.

## Runtime

- Mudança de conversa, encerramento da execução e outbox ocorrem na mesma transação.
- Reexecução idempotente não dispara eventos duplicados.
- Departamento e responsável precisam pertencer ao workspace e estar ativos no momento da execução.

## Editor e canvas

- Seletor de estado com explicação do efeito.
- Campos condicionais para fila, responsável e motivo.
- Preview com “Mover chat para Aguardando/Atendimento/Resolvido”.
- Importador mapeia `chat_controller`; Handoff antigo continua abrindo corretamente.

## Testes e aceite

- Matriz das três transições e idempotência dos eventos.
- Validação de departamento/responsável de outro workspace.
- Aceite: selecionar Resolvido fecha a conversa e inicia o fluxo configurado em Conversa finalizada somente uma vez.
