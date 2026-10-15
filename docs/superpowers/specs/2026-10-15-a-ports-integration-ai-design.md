# A — Portas nomeadas, Integração e IA direta

Data: 15/10/2026 · Programa: paridade Leona para migração (A → B → C → D → E)
Referência real: `docs/json-leona.txt` (funil de comprovante; não versionado — contém chaves).

## Objetivo

Blocos que podem dar certo ou errado (Integração, IA, e depois Aguarda Resposta) passam a ter **saídas nomeadas**, e o Bloco de IA passa a funcionar como na Leona: modelo + prompt no próprio bloco, lendo texto, imagem e PDF, gravando a resposta numa variável.

## 1. Portas nas conexões

- `AutomationEdgeSchema` ganha `port?: 'success' | 'failure' | 'reply' | 'timeout'`.
- Cada tipo de bloco declara as portas que expõe (`integration`, `ai`: `success`, `failure`; `wait_response` (spec B): `reply`, `timeout`).
- `runNode` de um bloco com portas devolve a porta escolhida; o engine segue a conexão com aquela porta. Sem conexão na porta escolhida: `failure` sem saída **falha a execução** com o erro do bloco; `success` sem saída é DEAD_END (comportamento atual).
- Compiler: blocos com portas aceitam no máximo uma conexão por porta, e exigem `success`. Conexões com `port` só são válidas a partir de blocos que expõem aquela porta.
- Compatibilidade: conexões sem `port` saindo de Integração/IA (fluxos atuais) continuam valendo como `success` — o comportamento de hoje (falha da integração derruba a execução) é preservado quando não há porta `failure`.
- Editor: o nó desenha uma alça por porta ("sucesso" verde, "erro" vermelho, como no print da Leona); `sourceHandle` = nome da porta, restaurado ao carregar (mesmo padrão do Menu).

## 2. Integração

Hoje: GET/POST/PUT, cabeçalhos, corpo com variáveis, `responseVariable` com a resposta inteira.

Acrescenta:
- **Campos da resposta**: lista `responseFields: [{ path: 'body.accepted', variable: 'kovil.receipt.accepted' }]` (até 20). `path` lê do objeto `{ status, body, headers }`; `variable` é onde gravar no contexto. Mantém `responseVariable` (resposta inteira) opcional.
- **Sucesso**: status 2xx. **Falha**: status fora de 2xx, timeout (15 s), erro de rede ou corpo inválido quando há `responseFields`. Na falha grava `integration.error = { status, message }` e segue `failure`.
- Variáveis no corpo, URL e cabeçalhos: mesma interpolação `{{caminho}}` de hoje.

## 3. Bloco de IA direto

Config do bloco (substitui o vínculo com Agente para este bloco; o bloco de Agente atual continua existindo para atendimento):

| Campo | Padrão | Nota |
|---|---|---|
| `model` | `gpt-5.4-mini` | lista curta de modelos OpenAI suportados |
| `systemPrompt` | — | obrigatório, até 12 000 caracteres |
| `userMessage` | `{{last_message}}` | interpolado |
| `understandImage` / `understandPdf` | `false` | anexa a mídia da última mensagem recebida |
| `responseVariable` | `resposta.gpt` | texto da resposta |
| `failReasonVariable` | `ai.fail.reason` | motivo da falha |
| `autoSendResponse` | `false` | se `true`, envia a resposta ao contato |
| `contextInteractions` | `1` | quantas mensagens anteriores da conversa entram como contexto (1–20) |

- **Chave da OpenAI**: uma por workspace, em Configurações → Integrações de IA, gravada cifrada (`FieldCipher`, AES-256-GCM, já existente no runtime). Nunca na config do bloco, nunca devolvida pela API (só "configurada: sim/não" e os 4 últimos caracteres). Sem chave no workspace, cai na `OPENAI_API_KEY` do ambiente; sem nenhuma, o bloco segue `failure` com motivo "Chave da OpenAI não configurada".
- **Sucesso**: resposta recebida → grava `responseVariable`, segue `success`. **Falha**: erro da API, timeout (60 s), mídia exigida e ausente, conteúdo bloqueado → grava `failReasonVariable`, segue `failure`.
- Consumo registrado como hoje (`usage`/custo) para cobrança.

## 4. Mídia recebida

Hoje a mensagem recebida guarda só o texto. Para a IA ler comprovantes:
- Ao receber imagem ou documento (PDF), o runtime baixa a mídia pelo Baileys (`downloadMediaMessage`) e grava numa tabela `MessageMedia` (`messageId`, `contentType`, `size`, `data bytea`), limite de **10 MB** por arquivo; acima disso guarda só os metadados e a IA falha com motivo "Arquivo grande demais".
- Retenção: **30 dias**, limpeza diária pelo runtime.
- Decisão registrada: Postgres em vez de armazenamento de objetos porque o projeto não tem bucket hoje; trocar por S3/R2 é uma mudança isolada nesta tabela.

## 5. Variáveis disponíveis

- `last_message`: texto da última mensagem recebida (também usado pela spec B).
- `contact.firstName`: primeiro nome derivado de `contact.name` (para o importador mapear `{first_name}`).
- `channel.phone`: número do canal WhatsApp da conversa (para o importador mapear `{instance_number}`).

## Fora de escopo

Gemini e outros provedores; validação de comprovante embutida da Leona (`expected_pix_key`, `validate_receipt_*`) — o funil exportado não usa (todas desligadas) e o prompt já faz essa validação; áudio.

## Testes

Unitários: seleção de porta e compatibilidade sem `port`; validação do compiler por porta; extração de `responseFields`; classificação sucesso/falha da Integração e da IA (provedor simulado); limite e retenção de mídia. Sem chamadas reais à OpenAI em teste.
