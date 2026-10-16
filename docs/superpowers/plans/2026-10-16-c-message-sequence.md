# C — Mensagem como sequência Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O bloco Mensagem envia uma sequência ordenada (texto com "digitando…", arquivo, mídia, pausa aleatória), com o próximo item só depois que o anterior foi enviado.

**Architecture:** `config.items` no bloco `message` (o formato antigo `{ text }` continua válido e vira um item). O engine envia um item por vez: cria a mensagem, deixa a execução `WAITING` com `_runtime.pendingSequence { stepId, index }` e o worker de envio, ao concluir aquele envio (sucesso ou falha definitiva), agenda o job de continuação `sequence_next`. Pausas viram o `delay` do próprio job de continuação. O "digitando…" é feito no worker de envio: manda a presença `composing` e adia o próprio job (`job.moveToDelayed` + `DelayedError` do BullMQ) — nenhum `sleep`. Lógica pura em `apps/runtime/src/automation/message-sequence.ts`.

**Tech Stack:** TypeScript, zod (`@nexo/contracts`), NestJS + BullMQ 5 + Prisma + Baileys (runtime), React + @xyflow/react (web), vitest.

**Spec:** `docs/superpowers/specs/2026-10-15-c-message-sequence-design.md`

## Global Constraints

- `config.items`: **1 a 30** itens.
- `text`: `text` 1–4096 caracteres (variáveis `{{…}}`), `typingSeconds` inteiro **0–30** (padrão 0).
- `file`: `url` HTTPS, `fileName` 1–255, `caption?` até 1024.
- `media`: `mediaType` `image` | `video` | `audio`, `url` HTTPS, `caption?` até 1024 (não vale para áudio), `ptt?` (só áudio).
- `pause`: `minSeconds`, `maxSeconds` inteiros **0–300**, `minSeconds ≤ maxSeconds`.
- Bloco `message` antigo (`{ text }`) continua válido em todo lugar; o editor converte para `items` ao abrir e salva no formato novo. Blocos `image`, `audio`, `sticker` continuam iguais.
- Ordem garantida: o item `i+1` só é criado depois que o item `i` ficou `SENT`/`DELIVERED` ou falhou definitivamente. Falha definitiva de um item falha a execução com o índice do item (código `MESSAGE_ITEM_FAILED`, mensagem "Falha ao enviar o item N da mensagem.", N começando em 1).
- Nenhum `sleep` dentro de worker.
- O web **não** importa valores de `@nexo/contracts` (só tipos); constantes espelhadas no editor.
- Textos de UI em português.

---

### Task 1: Contrato e compiler dos itens

**Files:**
- Modify: `packages/contracts/src/index.ts` (linha ~56 `AutomationMessageConfigSchema`)
- Test: `apps/api/src/modules/playbooks/compiler.test.ts`

**Interfaces:**
- Produces: `MESSAGE_MAX_ITEMS = 30`, `MESSAGE_MAX_TYPING_SECONDS = 30`, `MESSAGE_MAX_PAUSE_SECONDS = 300`, `AutomationMessageItemSchema` (união discriminada por `type`), `AutomationMessageConfigSchema` aceitando `{ text }` (legado) **ou** `{ items }`.

- [ ] **Step 1: Testes que falham** — em `compiler.test.ts`, um `describe('message items')` com um fluxo `trigger → message → outcome` e:
  - aceita `{ items: [{ type:'text', text:'Oi {{contact.firstName}}', typingSeconds: 3 }, { type:'pause', minSeconds: 2, maxSeconds: 5 }, { type:'file', url:'https://x.test/a.pdf', fileName:'a.pdf' }, { type:'media', mediaType:'audio', url:'https://x.test/a.ogg', ptt: true }] }` sem erros;
  - aceita o legado `{ text: 'Olá' }`;
  - rejeita (código `MESSAGE_TEXT_REQUIRED`): `items: []`; 31 itens; `typingSeconds: 31`; pausa com `minSeconds: 6, maxSeconds: 5`; pausa com `maxSeconds: 301`; `file` com `http://`; `media` com `mediaType:'document'`; `media` áudio com `caption`.
- [ ] **Step 2:** `npm test -w apps/api -- compiler` → FAIL.
- [ ] **Step 3: Implementar** no estilo compacto do arquivo:

```ts
export const MESSAGE_MAX_ITEMS=30;
export const MESSAGE_MAX_TYPING_SECONDS=30;
export const MESSAGE_MAX_PAUSE_SECONDS=300;
const MessageTextItemSchema=z.object({type:z.literal('text'),text:z.string().trim().min(1).max(4096),typingSeconds:z.number().int().min(0).max(MESSAGE_MAX_TYPING_SECONDS).default(0)}).strict();
const MessageFileItemSchema=z.object({type:z.literal('file'),url:HttpsUrlSchema,fileName:z.string().trim().min(1).max(255),caption:z.string().trim().max(1024).optional()}).strict();
const MessageMediaItemSchema=z.object({type:z.literal('media'),mediaType:z.enum(['image','video','audio']),url:HttpsUrlSchema,caption:z.string().trim().max(1024).optional(),ptt:z.boolean().optional()}).strict().refine(item=>item.mediaType!=='audio'||!item.caption,{message:'Áudio não tem legenda.',path:['caption']});
const MessagePauseItemSchema=z.object({type:z.literal('pause'),minSeconds:z.number().int().min(0).max(MESSAGE_MAX_PAUSE_SECONDS),maxSeconds:z.number().int().min(0).max(MESSAGE_MAX_PAUSE_SECONDS)}).strict().refine(item=>item.minSeconds<=item.maxSeconds,{message:'O mínimo não pode passar do máximo.',path:['minSeconds']});
export const AutomationMessageItemSchema=z.union([MessageTextItemSchema,MessageFileItemSchema,MessageMediaItemSchema,MessagePauseItemSchema]);
export const AutomationMessageConfigSchema=z.union([z.object({text:z.string().trim().min(1).max(4096)}).strict(),z.object({items:z.array(AutomationMessageItemSchema).min(1).max(MESSAGE_MAX_ITEMS)}).strict()]);
```
(`z.discriminatedUnion` não aceita membros com `.refine`; por isso `z.union`.) Confirme que `validateConfig` no compiler continua funcionando com uma união (ele só chama `safeParse`).
- [ ] **Step 4:** `npm test -w apps/api` e typecheck de api, runtime e web → PASS. Se algum consumidor de `AutomationMessageConfigSchema` quebrar por ser união, ajuste o mínimo e relate.
- [ ] **Step 5: Commit** — `feat(contracts): message node as an ordered sequence of items`

---

### Task 2: Lógica pura da sequência e conteúdo de envio

**Files:**
- Create: `apps/runtime/src/automation/message-sequence.ts`
- Test: `apps/runtime/src/automation/message-sequence.test.ts`
- Modify: `apps/runtime/src/whatsapp/outbound-content.ts` (`regularOutboundContent`)
- Test: o teste existente de `outbound-content` (ou crie `outbound-content.test.ts` se não existir)

**Interfaces:**
- Consumes: tipos de `@nexo/contracts`, `renderTemplate` de `./routing.js`.
- Produces:
  - `type SequenceItem` = item validado (text/file/media/pause), com `typingSeconds` já resolvido (0 quando ausente).
  - `sequenceItems(config: Record<string, unknown>): SequenceItem[]` — `items` válidos (via `AutomationMessageItemSchema.safeParse` item a item; inválido → lança `Error('INVALID_MESSAGE_ITEM')`), ou `[{ type:'text', text, typingSeconds: 0 }]` para o legado `{ text }`; vazio → `[]`.
  - `pauseSeconds(item: { minSeconds: number; maxSeconds: number }, random: () => number = Math.random): number` — inteiro uniforme em `[min, max]`: `min + Math.floor(random() * (max - min + 1))`.
  - `itemMessage(item: Exclude<SequenceItem, { type: 'pause' }>, context: Record<string, unknown>): { type: 'TEXT' | 'DOCUMENT' | 'IMAGE' | 'VIDEO' | 'AUDIO'; body: string | null; mediaUrl: string | null; providerPayload: Record<string, unknown> }` — interpola `text`, `caption`, `url` e `fileName` com `renderTemplate`; `text` → `TEXT` com `providerPayload { typingSeconds }` quando > 0; `file` → `DOCUMENT` com `providerPayload { kind:'file', fileName }`; `media` → `IMAGE`/`VIDEO`/`AUDIO` (`audio` leva `providerPayload { kind:'audio', ptt }`). Texto vazio após interpolação → lança `Error('EMPTY_MESSAGE')`; URL interpolada que não começa com `https://` → lança `Error('MEDIA_HTTPS_REQUIRED')`.
  - `regularOutboundContent` passa a montar `DOCUMENT` → `{ document: { url }, fileName, mimetype, caption? }` (mimetype por extensão: `.pdf` → `application/pdf`, `.jpg/.jpeg` → `image/jpeg`, `.png` → `image/png`, `.mp4` → `video/mp4`, `.mp3` → `audio/mpeg`, `.ogg` → `audio/ogg`, `.docx` → `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `.xlsx` → `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, senão `application/octet-stream`) e `VIDEO` → `{ video: { url }, caption? }`. Os casos atuais não mudam.

- [ ] **Step 1: Testes**: legado vira um item; item inválido lança; `pauseSeconds` com `random` fixo (`() => 0` → min; `() => 0.9999` → max; min = max → min); `itemMessage` para os quatro tipos, interpolação, vazio e http; `regularOutboundContent` para DOCUMENT (pdf e desconhecido) e VIDEO, e um caso existente (texto) inalterado.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar. **Step 4:** `npm test -w apps/runtime` + typecheck → PASS.
- [ ] **Step 5: Commit** — `feat(runtime): message sequence helpers, document and video outbound content`

---

### Task 3: Engine e worker de envio — um item por vez, digitando, pausa

**Files:**
- Modify: `apps/runtime/src/automation/automation-engine.service.ts`
- Modify: `apps/runtime/src/runtime-workers.service.ts` (`handleOutbound`, criação do worker de envio)
- Modify: `apps/runtime/src/queues.ts` (`OutboundJob` ganha `typed?: boolean`)

**Interfaces:**
- Consumes: Task 2 (`sequenceItems`, `pauseSeconds`, `itemMessage`).
- Produces: `AutomationJob.action` ganha `'sequence_next'`; `_runtime.pendingSequence { stepId: string; index: number }`; mensagens de sequência carregam `providerPayload.sequence { executionId, stepId, index }`.

Comportamento exigido:

1. **`case 'message'`** passa a: checar conversa/canal como hoje; `items = sequenceItems(node.config)` (erro → `NodeExecutionError('INVALID_NODE_CONFIG', …)`); chamar `this.runSequenceItem(..., index = 0)`.
2. **`runSequenceItem(executionId, workspaceId, conversationId, step, node, context, index, items, nextNodeId)`**:
   - `index >= items.length`: step `SUCCEEDED` (`output { items: items.length }`), execução volta a seguir com `finishInTransaction(..., nextNodeId, context sem _runtime.pendingSequence, …)` e retorna `'continue'`.
   - item `pause`: numa transação, execução `WAITING`, `currentNode: node.id`, `_runtime.pendingSequence { stepId, index }`; depois `queue.add('sequence_next', { executionId, action:'sequence_next', resumeStepId: step.id, sequenceIndex: index + 1 }, { jobId: automation-seq-${step.id}-${index + 1}, delay: pauseSeconds(item) * 1000, attempts: 5, backoff exponencial 1 s, removeOnComplete: 1_000, removeOnFail: 5_000 })`; retorna `'waiting'`.
   - outro item: `itemMessage(item, context)` (erros viram `NodeExecutionError` com o mesmo código); numa transação cria a `Message` OUTBOUND `PENDING` (`authorType:'automation'`, `authorId: executionId`, `providerPayload: { ...providerPayload, sequence: { executionId, stepId: step.id, index } }`), o `outboxEvent` `message.send.requested`, e deixa a execução `WAITING` com `pendingSequence { stepId, index }` e `currentNode: node.id`; retorna `'waiting'`. O step fica `RUNNING`.
3. **Retomada `sequence_next`**: em `executeLocked`, `sequenceDue = job.action === 'sequence_next' && pending.pendingSequence?.stepId === job.resumeStepId && job.sequenceIndex === pending.pendingSequence.index + 1`. Ao retomar: se o job traz `failedIndex` (ver 4) → step `FAILED` e `failExecution(executionId, 'MESSAGE_ITEM_FAILED', 'Falha ao enviar o item N da mensagem.')` com N = `failedIndex + 1`; senão volta a `RUNNING` e chama `runSequenceItem` com `index = job.sequenceIndex` (recarregando `items` do nó e o `nextNodeId` com `selectNextEdge`). Respeitar a contagem de `maxSteps` como hoje (a sequência é um passo só).
4. **Worker de envio (`handleOutbound(job, token)`)**:
   - Antes de enviar, se `providerPayload.typingSeconds > 0` e `!job.data.typed`: `await socket.sendPresenceUpdate('composing', jid)`, `await job.updateData({ ...job.data, typed: true })`, `await job.moveToDelayed(Date.now() + typingSeconds * 1000, token)`, `throw new DelayedError()`. Na volta envia normalmente (manda `'paused'` depois do envio, sem falhar se der erro).
   - Depois de gravar `SENT`: se `providerPayload.sequence` existe, `automationQueue.add('sequence_next', { executionId, action:'sequence_next', resumeStepId: stepId, sequenceIndex: index + 1 }, { jobId: automation-seq-${stepId}-${index + 1}, attempts: 5, backoff exponencial 1 s, removeOnComplete: 1_000, removeOnFail: 5_000 })`.
   - Na falha: só quando é a **última** tentativa (`job.attemptsMade + 1 >= (job.opts.attempts ?? 1)`) e há `sequence`, agendar o mesmo job com `failedIndex: index` em vez de seguir. Relançar o erro como hoje.
   - O `AutomationJob` ganha `sequenceIndex?: number; failedIndex?: number`. O worker de envio precisa da fila de automação: reutilize a instância criada em `onModuleInit` (guarde-a num campo) em vez de criar outra.
5. **Sem `sleep`**; o worker de automação continua com o lock por execução.

- [ ] **Step 1:** Implementar 1–5.
- [ ] **Step 2:** `npm run typecheck -w apps/runtime && npm test -w apps/runtime` → PASS.
- [ ] **Step 3:** No relatório, traçar à mão: (a) texto com digitando 3 s → pausa 2–5 s → arquivo; (b) legado `{ text }`; (c) falha definitiva do 2º item; (d) o job de envio repetido (retry após falha temporária) não agenda a continuação duas vezes (o `jobId` fixo garante).
- [ ] **Step 4: Commit** — `feat(runtime): send message items in order with typing and pauses`

---

### Task 4: Editor — lista de conteúdos

**Files:**
- Modify: `apps/web/src/features/playbooks/PlaybookEditorPage.tsx`
- Modify: `apps/web/src/features/playbooks/flow-builder.css`

Requisitos:
- Ao abrir um bloco `message` com o legado `{ text }`, converter para `{ items: [{ type:'text', text, typingSeconds: 0 }] }` (o salvamento grava o formato novo). Bloco novo nasce com um item de texto vazio.
- Modal da Mensagem: lista de conteúdos com reordenação por setas ↑/↓ (com `aria-label`) e remover; botões "+ Texto", "+ Arquivo", "+ Mídia", "+ Pausa"; desabilitar os botões ao chegar a 30 itens.
  - Texto: área de texto com a mesma barra de formatação do Menu (reutilize o componente/funções existentes) e "Digitando por N s" (0–30).
  - Arquivo: URL HTTPS, nome do arquivo, legenda opcional.
  - Mídia: tipo (Imagem/Vídeo/Áudio), URL HTTPS, legenda (oculta para áudio), "Enviar como mensagem de voz" (só áudio).
  - Pausa: "Entre N e M segundos" (0–300).
  - Erros inline nos mesmos limites do contrato (espelhar `MESSAGE_MAX_ITEMS=30`, `MESSAGE_MAX_TYPING_SECONDS=30`, `MESSAGE_MAX_PAUSE_SECONDS=300` localmente).
- Nó no canvas: mostra o primeiro texto (ou o rótulo do primeiro item) e "+N conteúdos" quando houver mais de um. Atualizar `nodeSummary` e a `rule` do catálogo ("1 a 30 conteúdos: texto, arquivo, mídia e pausa, enviados em ordem.").
- Manter o estilo JSX compacto do arquivo e os tokens do design system.

- [ ] **Step 1:** Implementar. **Step 2:** `npm run typecheck -w apps/web && npm run build -w apps/web` → PASS. **Step 3: Commit** — `feat(web): message block edits an ordered list of contents`
