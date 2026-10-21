# H — Fluxos padrão por conexão e palavras-chave

Data: 20/10/2026  
Roadmap: item 1.1

## Objetivo

Fazer o início das automações pertencer ao canal, como no Leona. Uma mensagem recebida deve primeiro retomar uma espera existente e, quando não houver espera, escolher um fluxo por palavra-chave, boas-vindas ou resposta padrão.

## Modelo

- `ChannelFlowConfig`: uma configuração por canal e slot.
- Slots: `WELCOME`, `DEFAULT_RESPONSE`, `CONVERSATION_RESOLVED` e `HANDOFF_CLOSED`.
- `windowHours` é usado somente por `DEFAULT_RESPONSE` e começa em 24.
- `ChannelKeyword`: palavra, texto normalizado, modo `EXACT` ou `CONTAINS` e fluxo.
- Todos os destinos pertencem ao mesmo workspace e precisam ter versão ativa. Um fluxo pausado continua visível, mas não pode ser escolhido nem iniciar novas execuções.
- `Channel.activePlaybookId` permanece durante a transição. A migração copia seu valor para `WELCOME`; a API antiga passa a atualizar ambos.

## API

- `GET /v1/channel-flow-settings`: canais, slots, palavras-chave e fluxos elegíveis.
- `PUT /v1/channels/:id/flow-settings`: substitui atomicamente os quatro slots e as palavras-chave do canal.
- `POST /v1/channel-flow-settings/bulk`: aplica a mesma configuração a até 100 canais.
- Escrita exige `channel.manage`; leitura exige sessão autenticada.
- Palavras são comparadas sem diferença entre maiúsculas/minúsculas e com espaços externos removidos. Duplicatas normalizadas no mesmo modo são rejeitadas.

## Ordem do roteamento de entrada

1. Retomar execução em `WAITING`.
2. Primeira palavra-chave correspondente; `EXACT` tem precedência e `CONTAINS` usa a palavra mais longa.
3. Se for a primeira mensagem do contato naquele canal, `WELCOME`.
4. Se não houve execução no canal dentro de `windowHours`, `DEFAULT_RESPONSE`.
5. Sem correspondência, não iniciar fluxo.

O fluxo escolhido pelo canal começa independentemente do evento configurado no bloco Gatilho, pois o slot é o gatilho operacional. Ainda assim, o nó inicial precisa continuar sendo um bloco `trigger` válido.

## Eventos de encerramento

- Ao marcar uma conversa como resolvida, criar `automation.channel_slot.requested` para `CONVERSATION_RESOLVED`.
- Ao devolver uma conversa humana para IA, criar o mesmo evento para `HANDOFF_CLOSED`.
- Eventos são duráveis no outbox e usam a versão ativa do destino no momento do processamento.

## Frontend

- Aba Configurações → Fluxos padrão.
- Busca e filtros Todas/Incompletas/Sem fluxos.
- Cartão expansível por canal, contador `N/4 configurados` e quatro seletores.
- Janela em horas ao lado da Resposta padrão.
- CRUD local de palavras-chave e escolha Exata/Contém.
- Seleção de canais e ação em massa usando a configuração de um canal como origem.
- Fluxos publicados são selecionáveis; pausados aparecem desabilitados.

## Segurança e consistência

- Nunca aceitar fluxo de outro workspace.
- A substituição de slots e palavras-chave ocorre em transação.
- A execução evita duplicar o mesmo fluxo enquanto ele estiver `RUNNING` ou `WAITING`.
- Limite de 50 palavras-chave por canal e 80 caracteres por palavra.

## Critérios de aceite

1. A primeira mensagem inicia `WELCOME`.
2. `comprovante` inicia a regra exata/contém correspondente antes de `WELCOME`.
3. Uma resposta dentro de `WAITING` só retoma a execução atual.
4. Uma nova mensagem antes da janela não inicia `DEFAULT_RESPONSE`; depois da janela, inicia.
5. A configuração antiga de automação do canal aparece migrada em Boas-vindas.
6. Fluxo pausado não inicia.
7. API, runtime e frontend compilam e os testes de seleção passam.
