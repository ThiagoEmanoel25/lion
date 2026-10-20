# Paridade do construtor de fluxos com o Leona

Atualizado em 20/10/2026. Substitui a auditoria de 15/10/2026.

Um bloco só conta como **Pronto** quando o editor, a validação de publicação e o runtime executam a mesma configuração. Parecer igual na tela não basta.

**Fontes de evidência**
- `[obs]`: visto no app do Leona em 20/10/2026. O GELATINA-FUNIL-04 foi só lido. No fluxo arquivado "teste 1" (sandbox, não roda para ninguém) cada bloco foi adicionado, o editor foi lido e o bloco foi excluído; o fluxo voltou a ter só o Início.
- `[net]`: gravador de API do navegador. Registrou só endpoints e nomes de campos, nunca valores, headers ou tokens.
- `[exp]`: exports JSON redigidos em `apps/api/src/modules/imports/fixtures/`.
- `[nexo]`: código atual deste repositório.

## Catálogo de blocos do Leona e estado no Nexo

O painel Ferramentas do Leona tem 25 blocos, nesta ordem `[obs]`:

| # | Leona | Nexo | Estado | Notas |
|---|---|---|---|---|
| — | Início | Gatilho | Pronto | O Início do Leona **não tem editor** `[obs]`: o fluxo começa pela conexão (canal), não por um gatilho configurado no fluxo. O export não traz o gatilho; na importação ele vira "mensagem recebida, uma vez por contato" `[exp]`. |
| 1 | Mensagem | Mensagem | Parcial | Leona `[obs]`: 8 tipos de conteúdo (Texto, Imagem, Vídeo, Áudio, Intervalo, Contato, Arquivo, Sticker). O texto tem "digitando" de 3 a 60 s, uma varinha (provável reescrita por IA) e **"Apagar mensagem ao aplicar etiqueta"**. Nexo `[nexo]`: texto, arquivo, imagem/vídeo/áudio e pausa, com "digitando…". **Faltam:** Contato (vCard), Sticker dentro da sequência, apagar ao aplicar etiqueta e reescrita por IA. Os arquivos importados continuam no CDN do Leona e precisam ser trocados. |
| 2 | Template WhatsApp | — | Falta | Leona `[obs]`: escolhe um template aprovado na Meta e define o timeout da resposta (minutos/horas/dias). Depende da WhatsApp Cloud API. |
| 3 | Etiquetas | Etiquetas | Pronto | Adiciona ou remove. Visual igual ao Leona: chips "🏷️ nome" e o texto "Adicionar etiquetas ao cliente" `[obs]`. |
| 4 | Botão PIX | — | Falta | Tipo interno `pix` `[obs]`. Campos: tipo da chave (CPF, CNPJ, Telefone, E-mail, Aleatória), chave, destinatário e valor (os dois últimos obrigatórios na API oficial), texto e imagem do card (só na API oficial). Em conexão não oficial envia a chave para copiar. **Fácil de fazer no Baileys** (mensagem com a chave). |
| 5 | Menu | Menu interativo | Pronto | Botões (até 3) ou lista (até 10), uma saída por opção, saída por inatividade e resposta em variável. |
| 6 | Carrossel | — | Falta | Tipo `carousel` `[obs]`. Texto de introdução; cartões com texto obrigatório, imagem (até 2 MB) e até 3 botões do tipo Resposta, URL, Copiar ou Ligar. Saídas: uma por botão de resposta, "Texto livre (fallback)" e timeout (0 = 2 dias, máx. 31). Entrega instável no Baileys. |
| 7 | Aguarda Resposta | Aguarda Resposta | Pronto | Saídas "respondeu" e "não respondeu" (ou espera indefinida), buffer de mensagens, salvar em campo, reagir, citar e mensagem antes de aguardar. No canvas: "Aguardar pela resposta do cliente." / "Ou caso não responda" / "Após N unidade" ou "Tempo indefinido" `[obs]`. |
| 8 | Controlador de Chat | Handoff | Parcial | Tipo `chat_controller` `[obs]`: só muda o estado do chat para **Aguardando, Atendimento ou Resolvidos**. O Handoff do Nexo cobre o "Atendimento" com fila e motivo. **Falta:** escolher o estado (principalmente marcar como Resolvido). Mudança pequena. |
| 9 | Notificação | Notificação | Pronto | Aviso interno para um número E.164, até 30 por hora. Não bloqueia o fluxo. |
| 10 | Condicional | Condicional | Pronto | Regras E/OU. No canvas: "resposta.gpt contém #R$ **E** …" e "Caso não atenda a condição o fluxo continua por aqui" `[obs]`. Um caminho sem ligação encerra o fluxo, como no Leona. |
| 11 | Distribuidor | Distribuidor | Pronto | Round-robin com peso e "não repetir contato". |
| 12 | Conexão de Fluxo | Conexão de Fluxo | Pronto | "Ir para o fluxo: NOME" `[obs]`. Usa a versão ativa do destino, com limite de 10 saltos. Destino pausado é recusado. |
| 13 | Pixel | Pixel | Pronto | No canvas: "Disparar evento no Facebook: PIXEL – nome / Tipo: Compra • Valor: 15,00 BRL" `[obs]`. O pixel precisa ser cadastrado no workspace (token cifrado). |
| 14 | Intervalo Inteligente | Intervalo inteligente | Parcial | Tipo `smart_interval` `[obs]`, com três modos: **Intervalo** (tempo, máx. 31 dias), **Data** (data e hora exatas) e **Horários** (dias da semana com uma faixa por dia, padrão 09:00–18:00, botão "Usar horários de funcionamento"; se já estiver dentro da faixa, segue na hora). O Nexo só tem o modo Intervalo. **Faltam Data e Horários.** |
| 15 | Departamento | Departamento | Parcial | Tipo `department` `[obs]`: escolhe departamentos cadastrados e atribui ao chat. O Nexo usa campo livre de fila/responsável. **Falta:** escolher da lista. |
| 16 | Integração | Integração | Pronto | GET/POST/PUT com saídas **sucesso** e **erro** `[obs]`, timeout de 30 s, mapeamento da resposta para variáveis e botão de teste. |
| 17 | Bloco de IA | Bloco de IA | Pronto | No canvas: "GPT: GPT-5 Mini / Resposta salva em: resposta.gpt / Sucesso / Em caso de erro o fluxo continua por aqui" `[obs]`. Lê imagem, PDF e áudio; tem condicionais inteligentes e identificação de comprovante. Usa a chave OpenAI do workspace. |
| 18 | Agente de IA | Agente de IA | Pronto no escopo atual | Usa um agente cadastrado e a base de conhecimento. |
| 19 | Kanban | Kanban | Pronto | Cria ou move o card para uma coluna. |
| 20 | Manipulador | — | Falta | Tipo `manipulator` `[obs]`: nome da variável/campo, operação (**Definir valor, Somar, Subtrair, Multiplicar, Dividir**) e valor com variáveis. Grava no contato, e a mudança vale para os passos seguintes. No canvas: "Atualizar a data de criação do contato na base ou gravar um campo personalizado". **Simples de fazer** (reaproveita o `jsonb_set` do Aguarda Resposta). |
| 21 | Venda aprovada | — | Falta | Tipo `approved_sale` `[obs]`: escolhe um produto cadastrado e define nome do cliente, valor e moeda por variáveis (padrão `{comprovante.nome_pagador}`, `{comprovante.valor}`), além de título e subtítulo da notificação push. É o "registro de venda" alimentado pela leitura do comprovante. O Resultado do Nexo registra um desfecho com valor, mas não tem produto nem push. |
| 22 | Pagamento | — | Falta | Na busca, "Pagamento" abre o mesmo bloco `pix` do Botão PIX `[obs]`. |
| 23 | Leona Pay | — | Não se aplica | Produto de pagamento próprio do Leona. |
| 24 | Ligar | — | Falta | Tipo `make_call` `[obs]`: **não é telefonia**. Faz uma ligação de WhatsApp que só toca, de 1 a 15 s (padrão 8 s), com áudio opcional (MP3/OGG/M4A, 16 MB). Funciona só em conexão não oficial e, segundo o próprio Leona, pode aumentar o risco de bloqueio do número. |
| 25 | Integração Kie.ai | — | Falta | Integração específica de terceiro (geração por IA). |

O Nexo tem dois blocos que o Leona não tem: **Resultado**, que registra o desfecho de negócio, e os blocos separados **Imagem/Áudio/Figurinha**, mantidos por compatibilidade.

## Recursos do editor e da lista de fluxos

| Leona `[obs]` | Nexo |
|---|---|
| Lista de fluxos com pastas, busca e filtros Todos/Ativos/Pausados; colunas Nome, Status, Blocos, Atualizado | Pronto |
| Status **Ativo/Pausado**, sem rascunho e sem publicação: o que é editado já está valendo | O Nexo tem rascunho → publicar (com validação) e também Pausar/Ativar. É uma diferença de propósito: a publicação evita colocar um fluxo quebrado no ar |
| Ferramentas (painel de blocos com busca) | Pronto |
| **Simular = chat local** "Teste local, sem WhatsApp e sem salvar": você digita como cliente e o fluxo responde passo a passo `[obs]` | **Diferente.** O Simular do Nexo calcula o caminho a partir de variáveis em JSON. Para quem monta funil, o chat do Leona é bem mais útil |
| Seletor de variáveis `<>` em cada campo; variáveis no formato `{first_name}`, `{full_name}`, `{comprovante.valor}` `[obs]` | O Nexo tem seletor de variáveis, no formato `{{contact.name}}`. O importador converte os formatos |
| Salvamento automático por bloco (`POST/PUT /flows/:id/flow_nodes`, `add_action`) `[net]` | O Nexo salva o fluxo inteiro e publica uma versão. É mais seguro, mas é preciso lembrar de salvar |
| Ações rápidas no bloco: editar, duplicar, excluir | Pronto |
| **LeonaAI**: assistente que monta e edita o fluxo, cobrado por carteira de créditos `[net]` | Falta |
| **Traduzir** fluxo, com opção de clonagem de voz `[net]` | Falta |
| **Arquivar** fluxo | Falta (o Nexo só pausa) |

## API observada `[net]`

Base: `https://apiaws.leonasolutions.io/api/v1`.

| Chamada | Formato |
|---|---|
| `GET /flows` | `{flows:[{id, account_id, name, description, status, active, created_at, updated_at, position, flow_folder_id, nodes_count}], folders:[], meta:{folder_id}}` |
| `POST /flows/:id/flow_nodes` · `PUT /flows/:id/flow_nodes/:id` · `POST …/flow_nodes/:id/add_action` | Cria o bloco `{flow_node:{name, node_type, position:{x,y}, description}}`, move o bloco `{flow_node:{position}}` e adiciona a ação padrão ao bloco |
| `GET /flows/names` | `{flows:[{id, name}]}` (usado pela Conexão de Fluxo) |
| `GET /flows/:id/editor_bundle` | Corpo **cifrado** (`_z, _q, _j, _r, _n`). Por decisão do projeto, não é aberto nem usado. A importação usa o export oficial |
| `GET /flow_translations/settings` | `{enabled, voice_clone_enabled}` |
| `GET /leona_ai/wallet` | Carteira de créditos da LeonaAI (`wallet_kind`, `status`, `auto_recharge.status`) |

## Achado: comprovantes da Kovil

A Integração dos funis 03, 04 e 05 chama `api.kovil.com.br/integrations/leona/receipts/<id>/resolve` `[obs]` `[exp]`. O corpo leva só o telefone, o número do chip e o `flow_id`, sem o resultado da IA.

O caminho `integrations/leona` indica que a Kovil busca a análise do comprovante **dentro do Leona**. No Nexo essa busca não encontra nada.

Antes de colocar os funis 03–05 no ar, é preciso combinar com a Kovil um endpoint que receba o comprovante no corpo (por exemplo, `"receipt": "{{resposta.gpt}}"`).

## Barreiras para lançar

| Bloco | Barreira | Impacto |
|---|---|---|
| Template WhatsApp | Exige a WhatsApp Cloud API: conta Meta Business verificada e templates aprovados | Bloqueia o bloco |
| Ligar | Ligação de WhatsApp não oficial; o próprio Leona avisa sobre risco de bloqueio do número. O suporte a ligações no Baileys precisa ser validado | Risco no canal |
| Pagamento / Botão PIX / Venda aprovada | Integração com um PSP ou gateway; não exige licença própria se o PSP processar | Aumenta o prazo |
| Pixel | Token da Meta Conversions API por cliente | Já resolvido (token cifrado) |
| Carrossel | Suporte instável no WhatsApp não oficial (Baileys) | Risco de entrega |

## Estamos no caminho certo?

Sim, no que mais importa. Os blocos que os funis reais usam (Mensagem, Aguarda Resposta, Bloco de IA, Condicional, Integração, Pixel, Etiquetas, Conexão de Fluxo, Distribuidor e Notificação) já existem no Nexo com o mesmo visual de canvas e as mesmas saídas. O Nexo também acrescenta proteções que o Leona não tem: validação antes de publicar, versões e o aviso de que um bloco sem saída encerra o fluxo.

As lacunas que mais aparecem para quem usa o produto:

1. **Simulador em forma de chat.** Hoje é a maior diferença de experiência para testar funis.
2. **Intervalo por Data e por Horários**, muito usado para mandar mensagens só no horário comercial.
3. **Manipulador** e **Controlador de Chat** (marcar como Resolvido). São pequenos e completam a parte de operação.
4. **Mensagem:** Contato, Sticker, apagar ao aplicar etiqueta.
5. **Venda aprovada** junto com a leitura de comprovante (`comprovante.valor`), que é como o Leona fecha o funil de vendas, e o mesmo motivo do problema com a Kovil.

## Próximos passos sugeridos

1. Resolver o endpoint da Kovil, que bloqueia os funis 03–05 em produção.
2. Simulador em chat (sem WhatsApp, sem salvar), reaproveitando o motor com um canal falso.
3. Intervalo: modos Data e Horários.
4. Manipulador e Controlador de Chat (estado Aguardando/Atendimento/Resolvidos).
5. Mensagem: Contato, Sticker e apagar ao aplicar etiqueta; Departamento escolhido da lista.
6. Botão PIX (envio da chave no Baileys) e Venda aprovada (produto + valor do comprovante).
7. Arquivar fluxo. Carrossel, Template e Ligar ficam por último por dependerem da API oficial ou terem risco no canal.

**Não verificado:** a execução real dos blocos no Leona (o Simulador não foi usado com mensagens), as opções internas de Integração Kie.ai e Leona Pay, o que a varinha da Mensagem faz e o formato da ação gravada em `add_action`. Também não foram abertos os editores de Notificação, Distribuidor e Kanban no Leona; eles foram comparados pelo canvas e pelo export.
