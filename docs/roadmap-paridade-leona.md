# Roadmap de paridade com o Leona

Consolida o que falta no Nexo para um cliente do Leona migrar sem perder função, e as mudanças de frontend necessárias. Base: auditorias de 20/10/2026 em [leona-flow-parity.md](leona-flow-parity.md) e [leona-platform-parity.md](leona-platform-parity.md).

Cada item tem: **o quê**, **por quê**, **frontend**, **backend/runtime** e **pronto quando**. Os tamanhos são estimativas relativas: P (até 2 dias), M (até 1 semana), G (mais de 1 semana).

## Andamento

| Item | Estado | Entrega |
|---|---|---|
| 1.1 Fluxos padrão + palavras-chave | Em validação funcional | Spec H, migration aplicada, API transacional, roteamento do runtime, eventos de encerramento, tela por conexão, ação em massa e associação visível no Gatilho. Compilação e testes automatizados passaram; falta validar as três rotas de entrada com um canal WhatsApp conectado. |
| 1.2 Chats ao vivo | Implementado em 21/10/2026; validação funcional pendente | Filas Aguardando/Atendendo/Resolvidos, contadores, filtros, transições pela lista, novo chat, canal visível, não respondidas e mensagens agendadas canceláveis. |
| 1.3 Respostas rápidas | Implementado em 21/10/2026; validação funcional pendente | CRUD com mídia, busca por `/atalho` no composer e inserção sem envio automático. |
| 1.4 Variáveis globais | Implementado em 21/10/2026; validação funcional pendente | CRUD cifrado, mascaramento, seletor no editor e resolução no runtime sem persistir segredos no contexto. |
| 2.1 em diante | Não iniciado | Specs individuais preparadas em `docs/superpowers/specs/`. |

---

## Fase 1: migrar a operação sem mudar o hábito do cliente

### 1.1 Fluxos padrão por conexão e palavras-chave (G)
**Por quê:** no Leona o gatilho fica na conexão, não no fluxo. Sem isso, nenhum funil importado começa sozinho.

**Frontend**
- Nova aba em Configurações → **Fluxos padrão**, com uma lista de canais. Cada linha mostra um contador "N/4 configurados" e expande em um formulário com 4 seletores de fluxo:
  - **Boas-vindas**;
  - **Resposta padrão**, com campo "janela (horas)", padrão 24;
  - **Conversa finalizada**;
  - **Atendimento finalizado**.
- Cada linha também tem uma seção **Palavras-chave**: lista de "palavra → fluxo", com "+ adicionar", e opção de correspondência exata ou "contém".
- Filtros Todas/Incompletas/Sem fluxos e uma busca por canal.
- **Seleção em massa**, para aplicar a mesma configuração em vários canais.
- O seletor de fluxo lista só fluxos publicados; fluxos pausados aparecem desabilitados com a etiqueta "Pausado".
- No editor de fluxos, o bloco Gatilho mostra **"Iniciado por: Boas-vindas em CHIP 01"**, com um link para a configuração, quando o fluxo estiver associado a algum slot.

**Backend/runtime**
- Tabela `ChannelFlowConfig {channelId, slot, playbookId}` e `ChannelKeyword {channelId, keyword, match, playbookId}`.
- Roteamento de mensagem recebida, nesta ordem:
  1. Se há uma execução esperando resposta, retoma a execução.
  2. Se a mensagem bate com uma palavra-chave, inicia o fluxo dela.
  3. Se é a primeira mensagem do contato no canal, inicia o fluxo de Boas-vindas.
  4. Se nenhuma execução rodou dentro da janela, inicia a Resposta padrão.
- Os eventos `conversation.resolved` e `handoff.closed` disparam os slots de finalizada.
- O "playbook ativo do canal" atual migra para o slot Boas-vindas.

**Pronto quando:** num canal com o FUNIL-01 em Boas-vindas, a primeira mensagem de um contato novo inicia o fluxo. A palavra "comprovante" inicia o fluxo configurado para ela. Um contato que volta depois de 24 h cai na Resposta padrão.

### 1.2 Chats ao vivo (M)
**Por quê:** é a tela que o atendente usa o dia todo.

**Frontend**
- Abas fixas **Aguardando / Atendendo / Resolvidos**, cada uma com contador.
- Filtros rápidos **Tudo / Não lidas / Não respondidas**.
- Em cada chat da lista, setas **← voltar** e **avançar →** para mover o chat entre as abas, sem precisar abrir o chat.
- Botão **Criar novo chat**, que pede o número e o canal e abre a conversa.
- **Mensagens agendadas:** no composer, a opção "Agendar envio" com data e hora; um painel lista as mensagens agendadas do chat, que podem ser canceladas.
- Etiqueta com o nome do canal em cada chat da lista.
- **Não marcar como lida** ao só passar o mouse; marca ao abrir.

**Backend/runtime**
- `Conversation.unreadCount` e `lastInboundAt`/`lastOutboundAt`, para o filtro "não respondidas".
- `ScheduledMessage` com job na fila, cancelável enquanto `PENDING`.

**Pronto quando:** dá para levar um chat de Aguardando até Resolvidos só pela lista, filtrar por não lidas e agendar uma mensagem que sai na hora marcada.

### 1.3 Respostas rápidas (P)
**Frontend:**
- CRUD em Configurações → Respostas rápidas, com atalho, texto e mídia opcional.
- No composer do chat, ao digitar `/` aparece a lista filtrável, e Enter insere a resposta.

**Backend:** `QuickReply {workspaceId, shortcut, body, mediaUrl?}`.

**Pronto quando:** `/pix` no composer insere o texto cadastrado.

### 1.4 Variáveis globais (P)
**Frontend:**
- CRUD em Configurações → Variáveis globais, com nome e valor. Valores marcados como sensíveis aparecem mascarados.
- O seletor de variáveis do editor de fluxos ganha o grupo **Globais**.

**Runtime:** o contexto da execução recebe `global.<nome>`.

**Pronto quando:** `{{global.link_grupo}}` numa Mensagem envia o valor cadastrado. A variável `link_grupo` dos funis importados pode virar global.

---

## Fase 2: o construtor de fluxos no nível do Leona

### 2.1 Simulador em chat (M)
**Por quê:** é a maior diferença de experiência no editor. O Leona simula como uma conversa ("Teste local, sem WhatsApp e sem salvar").

**Frontend**
- O botão **Simular** abre um painel lateral com aparência de WhatsApp: balões do fluxo à esquerda e um campo para você digitar como cliente.
- O bloco que está rodando fica destacado no canvas; o caminho percorrido fica marcado.
- Botões de menu aparecem como botões clicáveis.
- "Aguardar" mostra um atalho **"pular espera"**.
- Botão **Reiniciar**.
- Um campo opcional "variáveis iniciais" (o JSON de hoje) fica recolhido em "Avançado".
- Integração, IA e Pixel aparecem como cartões "simulado"; com a opção "executar de verdade", a IA e a Integração são chamadas de fato.

**Backend/runtime:** endpoint de simulação que roda o motor com um canal falso em memória (nada vai para o outbox nem fica salvo) e devolve os passos e as mensagens.

**Pronto quando:** o FUNIL-01 é percorrido inteiro pelo simulador, respondendo às perguntas, sem nenhuma mensagem real enviada.

### 2.2 Intervalo inteligente: Data e Horários (M)
**Frontend:** o editor ganha três abas, **Intervalo / Data / Horários**.
- **Data:** um seletor de data e hora.
- **Horários:**
  - os 7 dias com chave liga/desliga e uma faixa de horário por dia (padrão 09:00–18:00);
  - botão **"Usar horários de funcionamento"**, que copia de Configurações → Horários;
  - aviso "ative ao menos um dia".
- O bloco no canvas mostra "Espera de 1 minuto", "Até 25/10 14:00" ou "Seg–Sex 09:00–18:00".

**Runtime:**
- No modo Data, agenda para a data informada; se a data já passou, segue na hora.
- No modo Horários, segue na hora se já estiver dentro da faixa; senão agenda para o próximo início de faixa, no fuso do workspace.

**Pronto quando:** um intervalo em modo Horários, Seg–Sex 9–18, executado num sábado retoma na segunda às 09:00.

### 2.3 Manipulador (P)
**Frontend:**
- Bloco novo com os campos: nome do campo/variável (com seletor), operação (**Definir valor, Somar, Subtrair, Multiplicar, Dividir**) e valor com variáveis.
- No canvas: "Definir `campo` = valor" ou "Somar 1 a `campo`".

**Runtime:** atualização atômica com `jsonb_set` no `customFields`, a mesma técnica do Aguarda Resposta. Operações numéricas com valor que não é número seguem pela saída de erro.

**Pronto quando:** "Somar 1 a tentativas" executado duas vezes deixa `tentativas = 2`.

### 2.4 Controlador de Chat (P)
**Frontend:** o bloco Handoff vira "Controlador de Chat", com o seletor de estado **Aguardando / Atendimento / Resolvido**. Fila e motivo aparecem só em "Atendimento".

**Runtime:** "Resolvido" fecha a conversa e dispara o slot "Conversa finalizada" (ver 1.1).

### 2.5 Mensagem: conteúdos que faltam (M)
**Frontend:**
- No modal da Mensagem, os conteúdos **Contato** (nome e telefone, enviado como vCard) e **Sticker**.
- Em cada texto, a opção **"Apagar mensagem ao aplicar etiqueta"**, com seletor de etiqueta.
- O controle de "digitando" vira um slider de 3 a 60 s.

**Runtime:**
- Envio de vCard e de sticker pelo Baileys.
- Guardar o `externalId` da mensagem enviada; quando a etiqueta for aplicada, apagar a mensagem para todos.

### 2.6 Departamento por lista (P)
**Frontend:** o bloco Departamento usa um seletor das filas/departamentos cadastrados, no lugar do campo livre.

### 2.7 Arquivar fluxo (P)
**Frontend:**
- Ação **Arquivar** no menu ⋯ da lista de fluxos.
- Filtro "Arquivados", fora de "Todos".
- O fluxo arquivado abre só para leitura, com o botão "Desarquivar".

**Backend:** `PlaybookStatus.ARCHIVED`. Um fluxo arquivado não pode ser destino de Conexão de Fluxo nem de slot padrão.

---

## Fase 3: vendas (fecha o funil e resolve a Kovil)

### 3.1 Produtos (P)
**Frontend:** Configurações → Produtos, com nome, moeda, **preço mínimo, preço máximo e valor padrão**.

### 3.2 Bloco Venda aprovada (M)
**Frontend:**
- Seleção do produto, com a opção "+ Criar novo produto".
- Nome do cliente e valor por variável (padrão `{{comprovante.nome_pagador}}` e `{{comprovante.valor}}`), e moeda.
- Título e subtítulo da notificação.

**Runtime:**
- Registra `Sale {productId, contactId, value, currency, sourceExecutionId}`.
- Valor fora da faixa do produto usa o valor padrão.
- Envia uma notificação interna.

### 3.3 Leitura de comprovante estruturada (M)
**Por quê:** os funis 03–05 dependem da Kovil buscar a análise de comprovante dentro do Leona.

**Runtime:** o Bloco de IA com "Identificar comprovante" grava `comprovante.valor`, `comprovante.nome_pagador`, `comprovante.data` e `comprovante.referencia` a partir do JSON que o prompt já pede.

**Integração:** combinar com a Kovil um endpoint que receba esse objeto no corpo da requisição.

### 3.4 Dashboard de vendas (M)
**Frontend:**
- O Dashboard ganha as abas **Vendas** e **Atendimento** (a atual).
- Vendas tem filtros de período, canal, produto e moeda, e os cards Leads novos, Faturamento, Vendas, Ticket médio e Taxa de conversão.
- Gráficos por período e por horário, tabela de vendas com "Exportar CSV" e botão **Nova venda** (registro manual).
- ROAS, gasto em anúncios e lucro ficam para depois de 4.2.

### 3.5 Botão PIX (P)
**Frontend:** bloco com tipo de chave (CPF, CNPJ, Telefone, E-mail, Aleatória), chave, destinatário, valor e texto.

**Runtime (Baileys):** envia uma mensagem com a chave em formato fácil de copiar. O card oficial fica para quando houver a Cloud API.

---

## Fase 4: depois

| Item | Notas |
|---|---|
| 4.1 Disparos em massa | Exige cota por canal, intervalo aleatório entre envios, opt-in e lista de bloqueio. Há risco de banimento do número no WhatsApp não oficial |
| 4.2 Facebook Ads (campanhas, gasto, ROAS) | Exige app Meta com permissão `ads_read`, que passa por revisão da Meta |
| 4.3 Importar contatos do WhatsApp | A partir da agenda e dos chats do Baileys |
| 4.4 Agentes: vozes, modelos e "Criar com IA" | Vozes dependem de ElevenLabs ou similar |
| 4.5 Catálogo de integrações | Notas fiscais, UTMify, Gemini, OpenRouter, gateways de pagamento |
| 4.6 Carrossel, Template WhatsApp | Dependem da Cloud API; o Carrossel é instável no Baileys |
| 4.7 Ligar | Ligação de WhatsApp só com toque; validar suporte no Baileys e o risco de bloqueio |
| 4.8 Tradução de fluxos, Ferramentas MCP, Acesso de suporte | Baixa prioridade para a migração |

---

## Mudanças transversais de frontend

1. **Visual dos blocos no canvas:** todos no padrão já aplicado em Etiqueta, Condicional e Aguarda Resposta (cabeçalho em degradê, ícone em círculo, caixas internas com as saídas ao lado do texto de cada caminho). Faltam Mensagem, Menu, Integração, IA, Pixel, Kanban, Distribuidor, Notificação e Conexão de Fluxo.
2. **Modais de edição:** todos no design system do Nexo (claro, cabeçalho "BLOCO SELECIONADO", chaves em cartões, Cancelar/Salvar). Os editores que ainda aplicam a mudança na hora, sem botão Salvar, passam a ter Salvar.
3. **Seletor de variáveis `<>`** em todos os campos de texto dos blocos, com os grupos Contato, Conversa, Fluxo, Globais e Comprovante.
4. **Aviso de alterações não salvas:** como o Leona salva sozinho e o Nexo não, quem vem do Leona pode perder trabalho. Mostrar "Alterações não salvas" em destaque e confirmar antes de sair do editor ou fechar a aba (`beforeunload`). Avaliar um rascunho automático local a cada 30 s.
5. **Responsividade:** manter o padrão já aplicado (menu só com ícones entre 761 e 1100 px, ações do editor no canto inferior). Toda tela nova deve ser verificada em 390 e 768 px sem rolagem horizontal.
6. **Estados vazios** com ação direta, por exemplo "Nenhuma resposta rápida — Criar a primeira".

---

## Ordem sugerida

| Ordem | Item | Tamanho |
|---|---|---|
| 1 | 1.1 Fluxos padrão + palavras-chave | G |
| 2 | 2.1 Simulador em chat | M |
| 3 | 1.2 Chats ao vivo | M |
| 4 | 2.2 Intervalo Data/Horários | M |
| 5 | 1.3 Respostas rápidas · 1.4 Variáveis globais · 2.3 Manipulador · 2.4 Controlador · 2.6 Departamento · 2.7 Arquivar | P cada |
| 6 | 3.1–3.3 Produtos, Venda aprovada, comprovante estruturado | M |
| 7 | 2.5 Mensagem (Contato, Sticker, apagar) · 3.5 PIX · 3.4 Dashboard de vendas | M |
| 8 | Fase 4 | — |

Cada item da ordem 1 a 7 vira uma spec própria em `docs/superpowers/specs/` antes de ser implementado.
