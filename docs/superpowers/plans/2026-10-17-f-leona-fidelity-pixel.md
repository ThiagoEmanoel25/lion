# F — Fidelidade Leona e Pixel: plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development. Os passos usam checkbox (`- [ ]`).

**Objetivo:**
- o importador lê o export real da Leona sem perder conteúdo;
- a Integração ganha paridade no mapeamento da resposta e fica testável;
- novo bloco Pixel (Conversions API da Meta).

**Arquitetura:**
- **Lógica pura** em funções testadas:
  - conversor do importador;
  - `extractResponseField` compartilhado;
  - helpers do Pixel em `apps/runtime/src/automation/pixel.ts`.
- **Integração (I/O):** o engine e as rotas só fazem I/O.
- **Pixel:** o token fica cifrado no workspace (mesmo esquema da chave OpenAI). O `ctwa_clid` é capturado na mensagem recebida e gravado em `conversation.metadata.ctwa`.

**Stack:** TypeScript, zod (`@nexo/contracts`), Fastify + Prisma (api), NestJS + BullMQ + Baileys (runtime), React + @xyflow/react (web), vitest.

**Spec:** `docs/superpowers/specs/2026-10-17-f-leona-fidelity-pixel-design.md` (autoridade; leia a seção da sua tarefa).

## Restrições globais

- **Segredos:** `docs/json-leona.txt` contém segredos. Nunca leia nem commite esse arquivo. Use só `apps/api/src/modules/imports/fixtures/leona-real-export.redacted.json`, que já foi gerado e verificado.
- **Tokens:**
  - `api_key` da Leona nunca é copiado.
  - O token do Pixel nunca volta pela API (só `configured` + `last4`), nunca vai em URL e nunca é logado.
- **Web:** não importa valores de `@nexo/contracts` (só tipos). Constantes ficam espelhadas localmente.
- **Interface:**
  - textos em português;
  - JSX/código no estilo compacto já usado nos arquivos;
  - tokens do design system.
- **Timeout:** 30 s para a Integração (runtime, rota de teste e texto do modal) e para o envio do Pixel.
- **Portas:**
  - bloco `pixel` tem portas `success`/`failure`, sendo `success` obrigatória (mesmo padrão de `webhook`/`ai` em `packages/contracts/src/ports.ts`);
  - o web espelha `NODE_PORTS`.
- **Eventos do Pixel:**

  | Rótulo | `eventName` |
  |---|---|
  | Compra | `Purchase` |
  | Lead | `LeadSubmitted` |
  | Lead qualificado | `QualifiedLead` |
  | Iniciar checkout | `InitiateCheckout` |
  | Adicionar ao carrinho | `AddToCart` |
  | Ver conteúdo | `ViewContent` |

- **Valor do Pixel:**
  - obrigatório para `Purchase`;
  - depois da interpolação vira número ≥ 0;
  - aceita `15`, `15,90`, `R$ 15,90`, `1.234,56`.
- **Moeda:** ISO 4217 de 3 letras, padrão `BRL`.
- **Comandos:**
  - `npm test -w apps/api`, `npm test -w apps/runtime`;
  - `npm run typecheck` (todos);
  - `npm run build -w apps/web`.

---

### Task 1: Importador lê `data.actions[]` (spec §1)

**Arquivos:** `apps/api/src/modules/imports/converter.ts`, `converter.test.ts` e, se a resolução de etiquetas por nome precisar, `routes.ts`.

**Requisitos:**
- **Leitura das ações:**
  - Para cada nó, ler `data.actions[]` ordenadas por `order`, cada uma `{ action_type, config }`.
  - Nó `message`: todas as ações viram itens.
  - Demais tipos: a primeira ação do tipo esperado; ações a mais viram pendência.
  - O formato antigo (config plano) continua aceito; os testes atuais de `converter.test.ts` continuam verdes.
- **Mapeamento:** exatamente a tabela da spec §1 ("Mapeamento por ação" e "Regras da Condicional"), incluindo `response_mapping[name] ?? name` como variável dos campos da Integração.
- **Relatório honesto:** usar valor provisório marca o bloco como **pendência**, dizendo o campo que faltou.
- **Teste novo** com o fixture `leona-real-export.redacted.json`, conferindo:
  - nenhum texto de mensagem é o provisório;
  - os Aguarda Resposta têm `timeoutValue` 20/31, `timeoutUnit` `days`, `bufferSeconds` 0 e `waitIndefinitely` onde o export diz;
  - a Integração mantém a URL original e tem `responseFields` com as variáveis `kovil.receipt.accepted`, `kovil.receipt.duplicate`, `kovil.receipt.error`;
  - a Condicional de etiqueta é feita por nome;
  - a condição `resposta.gpt` usa `contains` com `#R$`, e outra usa `not_contains` com `#R$0,00`;
  - o prompt da IA não é o provisório, e `JSON.stringify(result)` não contém `<redacted>` vindo de `api_key`;
  - `Authorization` não entra nos headers;
  - os totais do relatório batem com os itens;
  - o nó `pixel` continua como pendência (a Tarefa 5 troca isso).
- **Commit:** `fix(imports): read real Leona action format`

### Task 2: Integração — paridade do mapeamento e correções da rota de teste (spec §2)

**Arquivos:**
- `packages/contracts/src/` (helper puro `extractResponseField(response:{status:number;body:unknown;headers:Record<string,string>}, path:string): {found:boolean;value:unknown}` + teste);
- `apps/runtime/src/automation/integration.ts` (passa a usar o helper);
- `automation-engine.service.ts` (caso `webhook`);
- `apps/api/src/modules/playbooks/integration-test.ts`, `routes.ts` e testes;
- `PlaybookEditorPage.tsx` (`WebhookEditor`);
- `flow-builder.css`.

**Requisitos:**
- **Timeout:** 30 s no runtime, na rota de teste e no texto do modal.
- **URL:** valores interpolados passam por `encodeURIComponent`, no runtime e na rota de teste. Cabeçalhos e corpo continuam sem codificação. Um helper puro com teste.
- **Rota de teste:**
  - URL bloqueada responde 422 `INTEGRATION_URL_BLOCKED`;
  - outros erros continuam 502;
  - limite de 10 testes por minuto por usuário via Redis, seguindo o padrão de `rateLimit` em `apps/api/src/modules/webhooks/routes.ts`; acima disso responde 429;
  - resposta acima de 100 KB chama `reader.cancel()` antes do erro.
- **Aba "Mapear resposta":** conforme spec §2.
  - "Status" com bolinha cinza/verde/vermelha e o código HTTP.
  - Prévia JSON da resposta dentro da aba.
  - Campos com **Nome do campo** (variável) primeiro e **Caminho (path)** depois.
  - Valor extraído por campo depois do teste: `→ <valor>`, ou "não encontrado" em vermelho, usando `extractResponseField`. Se o web não puder importar o helper por causa da regra do zod, espelhar a função com um comentário apontando a origem.
  - `<datalist>` com os caminhos do último resultado, até 50, folhas de `body` e `status`.
  - Aviso de que 3xx segue pela saída erro.
  - Link "Editar dados de teste", que abre o painel de simulação existente.
- **Commit:** `feat: integration mapping parity and safer test route`

### Task 3: Pixel — dados, contrato, API de configuração e compiler (spec §3)

**Arquivos:**
- `apps/api/prisma/schema.prisma` e uma migration nova em `apps/api/prisma/migrations/<timestamp>_meta_pixels/` (SQL escrito à mão, seguindo as migrations existentes; **não** aplicar em banco);
- `packages/contracts/src/index.ts` e `ports.ts`;
- `apps/api/src/modules/workspaces/routes.ts` (ou um módulo `pixels` registrado em `app.ts`);
- `apps/api/src/modules/playbooks/compiler.ts` e testes.

**Requisitos:**
- **Modelo:** `MetaPixel { id, workspaceId, name, pixelId, accessTokenEncrypted, accessTokenLast4, pageId?, testEventCode?, createdAt, updatedAt }` com `@@unique([workspaceId, name])`.
- **Cifra do token:** `encryptWebhookSecret`, já usado para a chave OpenAI. Nunca devolver o token.
- **Rotas** (`workspace.manage`, auditoria sem token):
  - `GET /v1/workspace/pixels` devolve `{ id, name, pixelId, pageId, testEventCode, tokenLast4 }[]`;
  - `POST` e `PATCH /v1/workspace/pixels/:id`: o token é opcional no PATCH;
  - `DELETE`.
- **Contrato:**
  - `MetaPixelInput`;
  - `PIXEL_EVENTS` (tabela das restrições globais);
  - `AutomationPixelConfigSchema` (`pixelId` cuid, `eventName` enum, `pageId?` ≤ 200, `value?` ≤ 200, `currency` `/^[A-Z]{3}$/` padrão `BRL`; `value` obrigatório se `Purchase`, via `superRefine`);
  - kind `pixel` em `AutomationNodeKindSchema`;
  - `NODE_PORTS.pixel = ['success','failure']`.
- **Compiler:**
  - `INVALID_PIXEL_CONFIG`;
  - pixel inexistente no workspace gera erro `PIXEL_NOT_FOUND`. Siga como `kanbanReferenceIssues` valida referências e onde é chamado.
- **Runtime provisório:** se o switch exaustivo do runtime quebrar, adicionar um `case 'pixel'` que lança `NOT_IMPLEMENTED`. A Tarefa 4 substitui.
- **Testes:** contrato (valor obrigatório em Purchase, moeda), compiler (portas, config, pixel inexistente) e rota (token nunca na resposta).
- **Commit:** `feat: Meta pixel settings, pixel node contract and validation`

### Task 4: Pixel — runtime (captura do `ctwa_clid` e envio)

**Arquivos:**
- novo `apps/runtime/src/automation/pixel.ts` + `pixel.test.ts`;
- `apps/runtime/src/whatsapp/message-content.ts` (+ teste);
- `session-manager.service.ts`;
- `automation-engine.service.ts`.

**Requisitos:**
- **Helpers puros em `pixel.ts`:**
  - `parsePixelValue(raw: string): number | null` cobre os formatos das restrições globais.
  - `buildPixelEvent(input: { eventName; eventTime: number; eventId: string; ctwaClid: string; pageId?: string; value?: number; currency: string }): object` monta exatamente o objeto `data[0]` da spec: `action_source: 'business_messaging'`, `messaging_channel: 'whatsapp'`, `user_data { ctwa_clid, page_id? }`, `custom_data { value?, currency }`.
  - `pixelOutcome(status: number | null, body: unknown, error?: string): { port: 'success' | 'failure'; error?: { status: number | null; message: string } }`: sucesso só com 2xx e `events_received ≥ 1`; a mensagem vem de `body.error.message`.
- **Captura:** `ctwaClidOf(message): string | null` em `message-content.ts` lê `contextInfo.externalAdReply.ctwaClid` de qualquer tipo de mensagem (use o `unwrap` existente). Na transação de mensagem recebida, gravar `conversation.metadata.ctwa = { clid, receivedAt }` só se ainda não existir.
- **Caso `pixel` no engine:**
  - Carregar o `MetaPixel` do workspace e decifrar o token com `FieldCipher`. Falha na decifragem segue pela saída erro.
  - Interpolar `pageId` (ou usar o `pageId` do pixel) e `value`.
  - Ler `ctwa` da conversa. Se não houver, seguir pela saída erro com "Contato não veio de um anúncio de clique para o WhatsApp".
  - Fazer `POST https://graph.facebook.com/${META_GRAPH_VERSION}/${pixelId}/events` com body JSON `{ data: [evento], access_token }`. `META_GRAPH_VERSION` é uma constante única no arquivo, valor `'v25.0'`.
  - Timeout de 30 s, `redirect: 'manual'`.
  - Na falha, gravar `pixel.error` no contexto.
  - Seguir porta e completar o step como o caso `webhook` faz.
  - Nunca logar o token.
- **Testes:** só dos helpers puros (o engine não tem harness). No relatório, traçar à mão o caminho com sucesso, o sem `ctwa` e o erro da Meta.
- **Commit:** `feat(runtime): pixel node sends Conversions API events`

### Task 5: Pixel — envio de teste e importador

**Arquivos:**
- `apps/api` (rota de teste do pixel);
- `apps/api/src/modules/imports/converter.ts`, `routes.ts` e testes.

**Requisitos:**
- **Rota de teste:**
  - `POST /v1/workspace/pixels/:id/test-event` (`workspace.manage`).
  - Exige `testEventCode` no pixel; sem ele responde 422 `PIXEL_TEST_CODE_REQUIRED`.
  - Monta o mesmo evento com `ctwa_clid` de teste `'TEST_CTWA_CLID'`, `event_id` aleatório e `test_event_code`.
  - Devolve `{ ok, status, eventsReceived, message }`.
  - Reaproveite `buildPixelEvent`/`pixelOutcome`. Se estiverem no runtime, mova-os para `packages/domain` e importe nos dois lados.
  - Limite de 5 por minuto por usuário.
- **Importador:**
  - `send_pixel_event` vira bloco `pixel`: `event_type` `Compra` → `Purchase` (e os outros rótulos da tabela); `item_value` → `value`; `currency`; `page_id` → `pageId`.
  - Em `routes.ts`, resolver o pixel pelo nome `pixel_config_name` no workspace. Sem correspondência, deixar `pixelId` vazio e registrar pendência "Configure o pixel ‘<nome>’ em Configurações".
  - `tracking_type` diferente de `Facebook` vira pendência.
  - Atualizar o teste do fixture real: o pixel vira bloco `pixel` com `Purchase`, `15`, `BRL`, e o `pageId` não pode ser o valor real (o fixture tem `<page-id>`).
- **Commit:** `feat: pixel test event route and Leona pixel import`

### Task 6: Pixel — web (configuração e editor do bloco)

**Arquivos:**
- `apps/web/src/features/settings/SettingsPage.tsx` e `settings/api/queries.ts`;
- `PlaybookEditorPage.tsx`;
- `flow-builder.css`;
- `apps/web/src/shared/types/api.ts`.

**Requisitos:**
- **Configurações:** aba "Pixels do Facebook", no padrão do `AiKeyPanel`.
  - Lista os pixels.
  - Criar/editar com nome, ID do pixel, token (campo senha; ao editar, em branco mantém o atual), Page ID padrão e código de teste.
  - Excluir com confirmação.
  - Mostrar o erro da mutação na tela, sem `void mutateAsync`.
- **Bloco `pixel` no catálogo:**
  - Ícone lucide `Target`, rótulo "Pixel", descrição "Envia eventos para o Facebook".
  - Alças sucesso/erro.
  - `nodeSummary`: "Compra · R$ 15" ou equivalente.
- **Modal igual ao print:**
  - Pixel configurado (select, com o texto "Configure seus pixels em Configurações → Pixels do Facebook" e link).
  - Tipo do evento.
  - Page ID (com variáveis).
  - Valor do item (com variáveis; obrigatório em Compra).
  - Moeda (padrão BRL, validação de 3 letras).
  - Quadro "Como funciona".
  - Aviso de que só contatos vindos de anúncio de clique para o WhatsApp geram evento.
  - Botão "Enviar evento de teste", desabilitado sem código de teste no pixel, mostrando o resultado da rota da Tarefa 5.
- **Commit:** `feat(web): pixel settings and pixel block editor`
