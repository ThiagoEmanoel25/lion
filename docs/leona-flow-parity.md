# Paridade do construtor de fluxos com o Leona

Atualizado em 20/10/2026. Substitui a auditoria de 15/10/2026.

Um bloco só conta como **Pronto** quando o editor, a validação de publicação e o runtime executam a mesma configuração. Parecer igual na tela não basta.

**Fontes de evidência**
- `[obs]`: visto no app do Leona em 20/10/2026, fluxo GELATINA-FUNIL-04, só leitura. Nada foi salvo, arrastado ou publicado.
- `[net]`: gravador de API do navegador. Registrou só endpoints e nomes de campos, nunca valores, headers ou tokens.
- `[exp]`: exports JSON redigidos em `apps/api/src/modules/imports/fixtures/`.
- `[nexo]`: código atual deste repositório.

## Catálogo de blocos do Leona e estado no Nexo

O painel Ferramentas do Leona tem 25 blocos, nesta ordem `[obs]`:

| # | Leona | Nexo | Estado | Notas |
|---|---|---|---|---|
| — | Início | Gatilho | Pronto | Mensagem recebida, conversa criada ou etiqueta adicionada, com opção "uma vez por contato". O export não traz o gatilho do Leona: na importação ele vira "mensagem recebida, uma vez por contato" `[exp]`. |
| 1 | Mensagem | Mensagem | Pronto | Sequência de texto, arquivo, mídia e pausa, com "digitando…" e "gravando…" no áudio. No canvas o Leona mostra a primeira linha ou o nome do arquivo `[obs]`. Os arquivos importados continuam hospedados no CDN do Leona e precisam ser trocados. |
| 2 | Template WhatsApp | — | Falta | Depende da API oficial (Cloud API). O canal Baileys não tem templates. Ver Barreiras. |
| 3 | Etiquetas | Etiquetas | Pronto | Adiciona ou remove. Visual igual ao Leona: chips "🏷️ nome" e o texto "Adicionar etiquetas ao cliente" `[obs]`. |
| 4 | Botão PIX | — | Falta | Envia uma chave ou copia-e-cola PIX. Escopo de pagamentos. |
| 5 | Menu | Menu interativo | Pronto | Botões (até 3) ou lista (até 10), uma saída por opção, saída por inatividade e resposta em variável. |
| 6 | Carrossel | — | Falta | Cartões com imagem e botões. O Baileys tem suporte limitado; é preciso validar a entrega antes de construir. |
| 7 | Aguarda Resposta | Aguarda Resposta | Pronto | Saídas "respondeu" e "não respondeu" (ou espera indefinida), buffer de mensagens, salvar em campo, reagir, citar e mensagem antes de aguardar. No canvas: "Aguardar pela resposta do cliente." / "Ou caso não responda" / "Após N unidade" ou "Tempo indefinido" `[obs]`. |
| 8 | Controlador de Chat | Handoff | Parcial | O Nexo passa para atendimento humano com fila e motivo. Não foi verificado se o Leona tem outras ações (pausar o bot, encerrar). |
| 9 | Notificação | Notificação | Pronto | Aviso interno para um número E.164, até 30 por hora. Não bloqueia o fluxo. |
| 10 | Condicional | Condicional | Pronto | Regras E/OU. No canvas: "resposta.gpt contém #R$ **E** …" e "Caso não atenda a condição o fluxo continua por aqui" `[obs]`. Um caminho sem ligação encerra o fluxo, como no Leona. |
| 11 | Distribuidor | Distribuidor | Pronto | Round-robin com peso e "não repetir contato". |
| 12 | Conexão de Fluxo | Conexão de Fluxo | Pronto | "Ir para o fluxo: NOME" `[obs]`. Usa a versão ativa do destino, com limite de 10 saltos. Destino pausado é recusado. |
| 13 | Pixel | Pixel | Pronto | No canvas: "Disparar evento no Facebook: PIXEL – nome / Tipo: Compra • Valor: 15,00 BRL" `[obs]`. O pixel precisa ser cadastrado no workspace (token cifrado). |
| 14 | Intervalo Inteligente | Intervalo inteligente | Parcial | Espera de 1 s a 31 dias `[nexo]`. Não verificado: se o Leona tem data exata e janela de horário. |
| 15 | Departamento | Departamento | Parcial | Fila ou responsável em campo livre. Falta escolher a partir das listas do workspace. |
| 16 | Integração | Integração | Pronto | GET/POST/PUT com saídas **sucesso** e **erro** `[obs]`, timeout de 30 s, mapeamento da resposta para variáveis e botão de teste. |
| 17 | Bloco de IA | Bloco de IA | Pronto | No canvas: "GPT: GPT-5 Mini / Resposta salva em: resposta.gpt / Sucesso / Em caso de erro o fluxo continua por aqui" `[obs]`. Lê imagem, PDF e áudio; tem condicionais inteligentes e identificação de comprovante. Usa a chave OpenAI do workspace. |
| 18 | Agente de IA | Agente de IA | Pronto no escopo atual | Usa um agente cadastrado e a base de conhecimento. |
| 19 | Kanban | Kanban | Pronto | Cria ou move o card para uma coluna. |
| 20 | Manipulador | — | Falta | Manipulação de variáveis (calcular, formatar, extrair). Comportamento exato não verificado. |
| 21 | Venda aprovada | — | Falta | Gatilho ou registro de venda vindo de plataformas de pagamento. |
| 22 | Pagamento | — | Falta | Cobrança dentro do fluxo. |
| 23 | Leona Pay | — | Não se aplica | Produto de pagamento próprio do Leona. |
| 24 | Ligar | — | Falta | Chamada de voz. Ver Barreiras. |
| 25 | Integração Kie.ai | — | Falta | Integração específica de terceiro (geração por IA). |

O Nexo tem dois blocos que o Leona não tem: **Resultado**, que registra o desfecho de negócio, e os blocos separados **Imagem/Áudio/Figurinha**, mantidos por compatibilidade.

## Recursos do editor e da lista de fluxos

| Leona `[obs]` | Nexo |
|---|---|
| Lista de fluxos com pastas, busca e filtros Todos/Ativos/Pausados; colunas Nome, Status, Blocos, Atualizado | Pronto |
| Status **Ativo/Pausado**, sem rascunho e sem publicação: o que é editado já está valendo | O Nexo tem rascunho → publicar (com validação) e também Pausar/Ativar. É uma diferença de propósito: a publicação evita colocar um fluxo quebrado no ar |
| Ferramentas (painel de blocos com busca) e Simular | Pronto |
| Ações rápidas no bloco: editar, duplicar, excluir | Pronto |
| **LeonaAI**: assistente que monta e edita o fluxo, cobrado por carteira de créditos `[net]` | Falta |
| **Traduzir** fluxo, com opção de clonagem de voz `[net]` | Falta |
| **Arquivar** fluxo | Falta (o Nexo só pausa) |

## API observada `[net]`

Base: `https://apiaws.leonasolutions.io/api/v1`.

| Chamada | Formato |
|---|---|
| `GET /flows` | `{flows:[{id, account_id, name, description, status, active, created_at, updated_at, position, flow_folder_id, nodes_count}], folders:[], meta:{folder_id}}` |
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
| Ligar | Exige um provedor de telefonia (SIP/VoIP) e um número; regras da Anatel no Brasil | Bloqueia o bloco |
| Pagamento / Botão PIX / Venda aprovada | Integração com um PSP ou gateway; não exige licença própria se o PSP processar | Aumenta o prazo |
| Pixel | Token da Meta Conversions API por cliente | Já resolvido (token cifrado) |
| Carrossel | Suporte instável no WhatsApp não oficial (Baileys) | Risco de entrega |

## Próximos passos sugeridos

1. Resolver o endpoint da Kovil, que bloqueia os funis 03–05 em produção.
2. **Manipulador**, que é o bloco faltante mais usado em funis de venda (variáveis).
3. Intervalo com data exata e janela de horário, conferindo antes como o Leona faz.
4. Departamento com seleção de filas e membros.
5. Arquivar fluxo.
6. Pagamentos (PIX, Venda aprovada), depois de escolher o PSP.

**Não verificado nesta auditoria:** opções internas dos blocos que não aparecem nos funis abertos (Manipulador, Carrossel, Controlador de Chat, Intervalo), e o comportamento do Simular do Leona. Abrir esses editores no Leona exigiria criar blocos no fluxo, e esta auditoria foi só de leitura.
