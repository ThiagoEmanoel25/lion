# F — Fidelidade da migração Leona: importador real, Integração e Pixel

Data: 17/10/2026 · Programa: paridade Leona (A → B → C → D → E → **F**)
Referência real: `docs/json-leona.txt` (não versionado, contém chaves). Prints da Leona: aba "Mapear resposta" da Integração e bloco Pixel.

## Por que

Rodando o importador (spec D) no export real, quase todo o conteúdo se perde. As mensagens viram "Mensagem importada — revise o conteúdo." e os Aguarda Resposta ficam todos com 1 hora. O prompt da IA, a URL e os campos da Integração, as condições e as etiquetas também se perdem. Mesmo assim o relatório diz "18 convertidos". A causa é que o export guarda cada configuração em `data.actions[]` (`{ action_type, config }`), com nomes próprios (`request_url`, `message_text`…). O conversor lê `data.config` ou `data` com outros nomes, e o fixture de teste segue esse formato inventado.

Esta spec cobre três frentes, nesta ordem:
1. O importador passa a ler o formato real.
2. A Integração fica igual à da Leona no mapeamento e mais testável.
3. Bloco Pixel novo, hoje só uma pendência no relatório.

---

## 1. Importador lê o formato real

### Leitura

- Cada nó tem `type` (`start`, `message`, `wait_response`, `condition`, `ai`, `integration`, `tags`, `kanban`, `pixel`) e `data.actions[]`, ordenadas por `order`. Cada ação tem `action_type` e `config`.
- **Mensagem**: todas as ações viram itens, na ordem.
- **Demais tipos**: usa a primeira ação do tipo esperado. Ações a mais viram pendência.
- O formato antigo do conversor (`data.config` plano) continua aceito, para não quebrar importações entre contas Nexo.

### Mapeamento por ação

| `action_type` | Campos da Leona | Nexo |
|---|---|---|
| `send_message` | `message_text`, `typing_delay_seconds` | item `text` (`typingSeconds` limitado a 0–30; se cortar, entra como "ajustado") |
| `send_file` | `file_url` (ou `media_file_info.direct_url` / `url`), `file_name` (ou `media_file_info.filename`) | item `file` |
| `send_multi_media` | `media_type` (`image`/`video`/`audio`), `media_file_info.direct_url` ?? `url`, `caption` | item `media`. Se `messages[]` não estiver vazio, entra como pendência |
| `delay_between_messages` | `delay_min_seconds`, `delay_max_seconds` (sem eles, `delay_seconds` nos dois) | item `pause` (limite 300 s; se cortar, "ajustado") |
| `wait_for_response` | `timeout_value`, `timeout_unit`, `wait_indefinitely`, `buffer_enabled`, `buffer_value` | `wait_response`: `timeoutValue`/`timeoutUnit` (`minutes`/`hours`/`days`); `bufferSeconds` = `buffer_enabled ? min(buffer_value, 300) : 0`. Se `reply_to_lead_enabled` ou `react_to_lead_check_enabled` estiver ligado, entra como pendência |
| `evaluate_condition` | `ruleType` (`all`/`any`), `conditions[]` | `condition` com `logic` e `rules`, conforme a tabela abaixo |
| `ai_call` | `model`, `system_prompt`, `user_message`, `understand_image`, `understand_pdf`, `understand_audio`, `response_variable`, `fail_reason_variable`, `auto_send_response`, `context_interactions` | IA direta (spec A). `context_interactions` fica em 1–20. `api_key` **nunca** é copiado. Se algum `validate_receipt_*` estiver ligado ou houver `expected_pix_key*` preenchido, entra como pendência |
| `make_http_request` | `request_url`, `request_method`, `request_headers`, `request_body`, `response_fields[{name,path}]`, `response_mapping{name→variável}` | `webhook`: `responseFields = [{ path, variable: response_mapping[name] ?? name }]`. Cabeçalhos sensíveis são removidos e viram pendência, como hoje |
| `add_tags` | `tags[]` (nomes), `action` (`add`/`remove`) | `tag` com `mode` e as etiquetas por nome |
| `send_pixel_event` | ver §3 | bloco `pixel` |

### Regras da Condicional

| Leona | Nexo |
|---|---|
| `category: system`, `systemSubtype: tag`, `systemOperator: equal` / `not_equal`, `tagName` | `contact.tagIds` com `in` / `not_in`, etiqueta encontrada pelo nome. Se não existir, é criada e entra como "ajustado" |
| `category: custom_field`, `fieldName`, `fieldOperator`, `fieldValue` | regra sobre a variável do fluxo `fieldName` (ex.: `resposta.gpt`). Operadores: `contains`→`contains`, `not_contains`→`not_contains`, `equal`→`equals`, `not_equal`→`not_equals` |
| outros | pendência com o texto original |

### Relatório honesto

- Um bloco só conta como **convertido** quando os campos principais foram lidos.
- Se precisou de valor provisório (URL `https://example.com/revise`, prompt ou mensagem padrão), conta como **pendência**, e a mensagem diz qual campo faltou.

### Testes

- Fixture **redigido** gerado a partir do export real, versionado em `apps/api/src/modules/imports/fixtures/`.
  - `api_key`, `Authorization` e `page_id` substituídos por marcadores.
  - O restante fica idêntico ao original.
- Os testes conferem valores reais:
  - os textos das mensagens não são o texto provisório;
  - os Aguarda Resposta têm 20 e 31 dias, `bufferSeconds` 0 e "indefinidamente" onde o export diz;
  - a Integração mantém a URL e tem três campos mapeados para `kovil.receipt.accepted|duplicate|error`;
  - a Condicional de etiqueta é feita por nome;
  - a condição `resposta.gpt` usa `contains` `#R$`;
  - o prompt da IA veio do export e `api_key` não aparece em lugar nenhum da saída;
  - o Pixel vira `Purchase` com valor 15 e moeda BRL;
  - os totais do relatório batem com os itens.

---

## 2. Integração igual à da Leona, e testável

### Aba "Mapear resposta"

- **Topo**: "Status" (cinza antes do teste; verde se 2xx, vermelho nos outros casos, com o código HTTP) e o botão **Testar requisição**.
- **Prévia da resposta** (corpo em JSON formatado) dentro da própria aba, com o texto "Execute um teste para ver a resposta da requisição" antes do primeiro teste.
- **Lista "Campos"**, com o botão "+ Adicionar campo" (até 20). Cada campo tem:
  - **Nome do campo**: é a variável onde o valor fica gravado, usada depois como `{{nome}}`;
  - **Caminho (path)**: a partir de `{ status, body, headers }`, por exemplo `body.accepted`;
  - lixeira para remover.
- **Depois de um teste**, cada campo mostra o valor extraído (`→ true`, `→ "Comprovante duplicado"`), ou "não encontrado" em vermelho. O caminho ganha sugestões (`<datalist>`) com os caminhos do último resultado.
- **"Salvar resposta completa em"** continua existindo, opcional.

### Execução e teste

- Timeout de **30 s**, no runtime, na rota de teste e no texto do modal.
- Rota de teste:
  - URL bloqueada responde **422** (não 502);
  - limite de **10 testes por minuto por usuário** (mesmo padrão em Redis de `/v1/hooks`);
  - resposta acima de 100 KB cancela o stream.
- Valores interpolados **na URL** passam por `encodeURIComponent`. Cabeçalhos e corpo continuam como estão.
- O modal avisa que redirecionamentos (3xx) seguem pela saída **erro**.
- As variáveis do teste vêm dos dados de simulação do fluxo, como hoje. O modal mostra um link "Editar dados de teste".

---

## 3. Bloco Pixel (Conversions API da Meta)

### Configuração do workspace (Configurações → Pixels do Facebook)

- Cada pixel tem:
  - **nome**;
  - **ID do pixel/dataset**;
  - **token de acesso**, cifrado como a chave da OpenAI e nunca devolvido pela API (só "configurado" + 4 últimos);
  - **Page ID padrão** (opcional);
  - **código de evento de teste** (opcional).
- Modelo `MetaPixel { workspaceId, name, pixelId, accessTokenEncrypted, accessTokenLast4, pageId?, testEventCode? }`. O nome é único por workspace.
- Permissão `workspace.manage` e registro de auditoria sem o token.

### Bloco `pixel`

Config:
- `pixelId` (referência ao `MetaPixel`);
- `eventName`;
- `pageId?` (aceita variáveis; se vazio, usa o padrão do pixel);
- `value` (aceita variáveis);
- `currency` (ISO 4217, padrão `BRL`).

Eventos na interface:

| Rótulo | `eventName` |
|---|---|
| Compra | `Purchase` |
| Lead | `LeadSubmitted` |
| Lead qualificado | `QualifiedLead` |
| Iniciar checkout | `InitiateCheckout` |
| Adicionar ao carrinho | `AddToCart` |
| Ver conteúdo | `ViewContent` |

- `value` é obrigatório para Compra. Depois da interpolação, precisa virar um número ≥ 0 (aceita `15`, `15,90` e `R$ 15,90`).
- Saídas: **sucesso** e **erro** (portas nomeadas, spec A).
- Editor igual ao print:
  - pixel, com link para Configurações;
  - tipo do evento, Page ID, valor do item e moeda;
  - quadro "Como funciona";
  - botão **Enviar evento de teste**, habilitado só se o pixel tem código de teste. Ele usa o `test_event_code` para o evento aparecer em "Eventos de teste" no Gerenciador de Eventos sem contar como conversão.

### Identificação do anúncio (`ctwa_clid`)

- A Meta exige o `ctwa_clid` para eventos de mensagens. Ele vem só na **primeira mensagem** de quem clicou num anúncio de clique para o WhatsApp.
- No Baileys, ele chega em `contextInfo.externalAdReply.ctwaClid` da mensagem recebida.
- O runtime grava `conversation.metadata.ctwa = { clid, sourceId?, receivedAt }` ao receber a mensagem e não sobrescreve um valor existente.
- Sem `ctwa_clid` na conversa, o bloco segue por **erro** com o motivo "Contato não veio de um anúncio de clique para o WhatsApp". O motivo fica gravado em `pixel.error`.

### Envio

- `POST https://graph.facebook.com/{versão}/{pixelId}/events`. A versão fica numa constante única do runtime.
- O token vai no corpo (`access_token`), nunca na URL.
- Corpo:
  - `data: [{ event_name, event_time, event_id: <id do step>, action_source: 'business_messaging', messaging_channel: 'whatsapp', user_data: { ctwa_clid, page_id? }, custom_data: { value, currency } }]`;
  - `test_event_code` só no envio de teste.
- `event_id` = id do step: se o job for repetido, a Meta deduplica.
- Timeout de 30 s.
- **Sucesso**: 2xx com `events_received ≥ 1`. **Erro**: qualquer outro resultado, com `pixel.error = { status, message }` (mensagem da Meta, sem o token).
- O consumo não é cobrado.

### Importador

- `send_pixel_event` → bloco `pixel`.
- O pixel é encontrado pelo nome (`pixel_config_name`) entre os pixels do workspace. Se não existir, o bloco é criado sem pixel e entra como pendência ("Configure o pixel ‘PIXEL - MARITZA’ em Configurações").
- `event_type` (`Compra` etc.) → `eventName` pela tabela acima.
- `item_value` → `value`, `currency` → `currency`, `page_id` → `pageId`.
- `tracking_type` diferente de `Facebook` entra como pendência.

### A validar antes de produção

A documentação da Meta para mensagens mostra `whatsapp_business_account_id` em `user_data` na API oficial. A Leona pede **Page ID** para conexões não oficiais, como a nossa (Baileys). A implementação envia `page_id` quando preenchido. Antes de liberar, confirmar com um evento de teste real, pelo botão "Enviar evento de teste", que a Meta aceita o evento nesse formato. Se não aceitar, ajustar só o montador do `user_data`.

---

## Fora de escopo

- Outros rastreadores (Google Ads, TikTok).
- Envio de eventos fora de fluxos.
- Captura de `ctwa_clid` pela API oficial do WhatsApp.
- Árvore clicável na prévia da Integração: o `<datalist>` cobre o caso.

## Testes

- **Importador**: o fixture real redigido da §1.
- **Integração**:
  - valor extraído por campo (função pura compartilhada entre runtime e prévia);
  - `encodeURIComponent` só na URL;
  - 422 para URL bloqueada;
  - limite de chamadas da rota de teste;
  - cancelamento acima de 100 KB.
- **Pixel**:
  - parse do valor (`15`, `15,90`, `R$ 15,90`, inválido);
  - montagem do corpo, com `event_id` = step e o token fora da URL;
  - sucesso/erro conforme `events_received`;
  - falha sem `ctwa_clid`;
  - captura do `ctwaClid` na mensagem recebida, sem sobrescrever;
  - rota de pixels nunca devolve o token;
  - importador por nome do pixel.
- Sem chamadas reais à Meta nos testes.
