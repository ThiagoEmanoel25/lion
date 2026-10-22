# Fase 2 — Construtor de fluxos no nível do Leona

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar os 7 itens da Fase 2 do roadmap, levando o construtor de fluxos à paridade funcional com o Leona.

**Architecture:** Cada item é independente no runtime e no editor. A ordem é: primeiro os blocos novos/evoluídos (M, N, O, Q, R), depois a Mensagem (P), e por último o Simulador (L) — assim o simulador já conhece todos os blocos novos. Cálculos puros vão para `packages/domain`; contratos zod em `packages/contracts`; o web espelha constantes localmente e nunca importa valores de `@nexo/contracts`.

**Tech Stack:** Fastify + Prisma + zod (api), NestJS + BullMQ + Baileys (runtime), React + @xyflow/react + react-query (web), vitest.

**Specs:**
- Task 1–2: `docs/superpowers/specs/2026-10-21-m-smart-interval-design.md`
- Task 3: `docs/superpowers/specs/2026-10-21-n-manipulator-design.md`
- Task 4: `docs/superpowers/specs/2026-10-21-o-chat-controller-design.md`
- Task 5: `docs/superpowers/specs/2026-10-21-q-department-selector-design.md`
- Task 6: `docs/superpowers/specs/2026-10-21-r-archive-playbook-design.md`
- Task 7–8: `docs/superpowers/specs/2026-10-21-p-message-parity-design.md`
- Task 9–11: `docs/superpowers/specs/2026-10-21-l-chat-simulator-design.md`

## Global Constraints

- **O web nunca importa valores de `@nexo/contracts`**, só tipos. Constantes são espelhadas localmente (padrão já usado em `apps/web/src/features/playbooks/condition-catalog.ts`).
- **Estilo do código:** JSX denso em linha única, como o resto de `PlaybookEditorPage.tsx`. Comentários só onde explicam o porquê, na densidade do arquivo vizinho.
- **Compatibilidade:** toda config antiga continua abrindo e executando. Normalização acontece ao ler, nunca por migração destrutiva da definição salva.
- **Fuso:** todo cálculo de data usa o timezone do workspace (`Workspace.timezone`, padrão `America/Bahia`), nunca o do servidor.
- **Modais de edição:** design system do Nexo (claro, cabeçalho "BLOCO SELECIONADO", `ai-toggle-card` para chaves, rodapé Cancelar/Salvar).
- **Bloco sem saída encerra o fluxo** (regra já valendo); nenhuma task pode voltar isso a erro de publicação.
- **Segredos nunca entram no contexto da execução nem no step** (regra já valendo para variáveis globais).
- **Idempotência:** retomada por `stepId` não duplica passo nem evento.
- Toda task roda `npm test` e `npm run typecheck` na raiz antes do commit.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `packages/domain/src/delay.ts` | **Novo.** `nextDelayAt` e normalização do config do Intervalo |
| `packages/domain/src/manipulator.ts` | **Novo.** Operações aritméticas e validação de alvo |
| `packages/domain/src/simulation.ts` | **Novo.** Motor de simulação puro |
| `packages/contracts/src/index.ts` | União do delay, kind `manipulator`, estado do controlador, itens contact/sticker |
| `apps/runtime/src/automation/automation-engine.service.ts` | Casos `delay`, `manipulator`, `handoff` |
| `apps/api/src/modules/playbooks/compiler.ts` | Validação dos blocos novos |
| `apps/api/src/modules/playbooks/simulation/` | **Novo.** Sessões e rotas do simulador |
| `apps/web/src/features/playbooks/PlaybookEditorPage.tsx` | Editores e canvas dos blocos |
| `apps/web/src/features/playbooks/SimulatorPanel.tsx` | **Novo.** Painel de chat do simulador |

---

### Task 1: Intervalo inteligente — contrato e cálculo puro

**Files:**
- Create: `packages/domain/src/delay.ts`
- Create: `packages/domain/src/delay.test.ts`
- Modify: `packages/domain/src/index.ts` (exportar)
- Modify: `packages/contracts/src/index.ts` (`AutomationDelayConfigSchema`, linha ~124)

**Interfaces:**
- Produz: `normalizeDelayConfig(config: unknown): DelayConfig`, `nextDelayAt(config: DelayConfig, now: Date, workspaceTimezone: string): {at: Date; mode: DelayMode}`, tipos `DelayConfig` e `DelayMode`.
- Consome: nada de tasks anteriores.

- [ ] **Step 1: Escrever os testes do cálculo**

Em `packages/domain/src/delay.test.ts`, cobrir (fuso `America/Bahia`, UTC-3, sem horário de verão):

```ts
// duration: normaliza config legada {seconds} e {duration,unit}
expect(normalizeDelayConfig({seconds: 300})).toEqual({mode:'duration', duration:300, unit:'seconds'});
expect(normalizeDelayConfig({duration:5, unit:'minutes'})).toEqual({mode:'duration', duration:5, unit:'minutes'});

// date: passada continua imediatamente
const now = new Date('2026-10-22T12:00:00Z');
expect(nextDelayAt({mode:'date', runAt:'2026-10-20T10:00:00-03:00'}, now, 'America/Bahia').at).toEqual(now);

// schedule: sábado 10:00 com Seg–Sex 09:00–18:00 → segunda 09:00 local
const sat = new Date('2026-10-24T13:00:00Z'); // sábado 10:00 em -03:00
const weekdays = {mode:'schedule', days:[1,2,3,4,5].map(day=>({day, enabled:true, start:'09:00', end:'18:00'}))};
expect(nextDelayAt(weekdays, sat, 'America/Bahia').at.toISOString()).toBe('2026-10-26T12:00:00.000Z');

// schedule: dentro da faixa continua imediatamente
const mon = new Date('2026-10-26T15:00:00Z'); // segunda 12:00 local
expect(nextDelayAt(weekdays, mon, 'America/Bahia').at).toEqual(mon);

// schedule: antes da faixa no mesmo dia agenda para o início de hoje
const monEarly = new Date('2026-10-26T10:00:00Z'); // segunda 07:00 local
expect(nextDelayAt(weekdays, monEarly, 'America/Bahia').at.toISOString()).toBe('2026-10-26T12:00:00.000Z');
```

Incluir também: virada de semana (domingo ativo), limite de 365 dias no modo `date`, erro quando nenhum dia está ativo, e erro quando `start >= end`.

- [ ] **Step 2: Rodar e ver falhar**

`npx vitest run packages/domain/src/delay.test.ts` — espera FAIL ("nextDelayAt is not defined").

- [ ] **Step 3: Implementar `packages/domain/src/delay.ts`**

Converter para o fuso com `Intl.DateTimeFormat` (mesmo padrão de `systemContext` em `packages/contracts/src/conditions.ts`, que já resolve weekday/time/date por fuso). Evitar biblioteca nova.

```ts
export type DelayMode = 'duration' | 'date' | 'schedule';
export type ScheduleDay = { day: number; enabled: boolean; start: string; end: string };
export type DelayConfig =
  | { mode: 'duration'; duration: number; unit: 'seconds'|'minutes'|'hours'|'days' }
  | { mode: 'date'; runAt: string }
  | { mode: 'schedule'; timezone?: string; days: ScheduleDay[] };
```

Regras da spec M: duração de 1 s a 31 dias; `date` no passado continua já; `schedule` procura o próximo início ativo varrendo no máximo 8 dias; faixa que atravessa a meia-noite é rejeitada nesta entrega.

- [ ] **Step 4: Rodar os testes**

`npx vitest run packages/domain/src/delay.test.ts` — espera PASS.

- [ ] **Step 5: Atualizar o contrato**

Em `packages/contracts/src/index.ts`, trocar `AutomationDelayConfigSchema` por uma união discriminada que aceita as três formas **e** as duas legadas (`{seconds}` e `{duration,unit}` sem `mode`), usando `z.preprocess` com `normalizeDelayConfig`. Limites: `duration` 1 s–31 dias, `date` até 365 dias, `schedule` com ao menos um dia ativo.

- [ ] **Step 6: Rodar typecheck e testes**

`npm run typecheck && npm test` na raiz — espera tudo passar, inclusive os testes existentes do compiler com configs antigas de delay.

- [ ] **Step 7: Commit**

```bash
git add packages/domain packages/contracts
git commit -m "feat(domain): smart interval config union with duration, date and schedule modes"
```

---

### Task 2: Intervalo inteligente — runtime, editor e importador

**Files:**
- Modify: `apps/runtime/src/automation/automation-engine.service.ts` (`case 'delay'`, linha ~255)
- Modify: `apps/web/src/features/playbooks/PlaybookEditorPage.tsx` (editor e `nodeSummary`)
- Modify: `apps/web/src/features/playbooks/flow-builder.css`
- Modify: `apps/api/src/modules/imports/converter.ts` (`smart_interval`)
- Test: `apps/runtime/src/automation/delay.test.ts` (novo)

**Interfaces:**
- Consome da Task 1: `nextDelayAt`, `normalizeDelayConfig`, `DelayConfig`.
- Produz: nada que outra task consuma.

- [ ] **Step 1: Teste do runtime**

Em `apps/runtime/src/automation/delay.test.ts`, provar que o `delay` agenda usando o instante devolvido por `nextDelayAt` (não `seconds * 1000`) e que o contexto registra `{mode, scheduledFor}` para diagnóstico.

- [ ] **Step 2: Rodar e ver falhar**

- [ ] **Step 3: Trocar o cálculo no runtime**

No `case 'delay'`, substituir a validação de `seconds` por `nextDelayAt(normalizeDelayConfig(node.config), new Date(), workspaceTimezone)`. Buscar o timezone do workspace uma vez e passar adiante. Manter: se não há próximo nó, o bloco encerra o fluxo (regra atual, linhas logo abaixo). O `delay` do BullMQ passa a ser `at.getTime() - Date.now()`, com piso em 0.

- [ ] **Step 4: Rodar os testes do runtime**

- [ ] **Step 5: Editor com três abas**

No modal do Intervalo, abas **Intervalo / Data / Horários** no padrão já usado pelo editor do Aguarda Resposta (`ai-toggle-card`, rodapé Cancelar/Salvar):
- Intervalo: número + unidade.
- Data: `<input type="datetime-local">` e o fuso do workspace exibido ao lado; converter para ISO com offset no save.
- Horários: os 7 dias com chave liga/desliga e faixa `start`/`end` (padrão 09:00–18:00); botão **Usar horários de funcionamento** que copia de Configurações → Horários (copia valores, não cria referência viva); aviso "Ative ao menos um dia da semana" quando nenhum estiver ligado.

- [ ] **Step 6: Preview no canvas**

Em `nodeSummary`, para `kind==='delay'`: `Espera de 5 minutos`, `Até 25/10 14:00` ou `Seg–Sex 09:00–18:00` (agrupar dias contíguos com a mesma faixa).

- [ ] **Step 7: Importador**

Em `converter.ts`, mapear `smart_interval` por subtipo para os três modos. Data sem fuso usa o timezone do workspace e gera **ajuste** no relatório; configuração ilegível vira **pendência** e nunca é convertida em duração silenciosamente.

- [ ] **Step 8: Rodar tudo e commitar**

```bash
npm test && npm run typecheck && npm run build -w @nexo/web
git add apps packages
git commit -m "feat: smart interval date and schedule modes in runtime, editor and importer"
```

---

### Task 3: Bloco Manipulador

**Files:**
- Create: `packages/domain/src/manipulator.ts`, `packages/domain/src/manipulator.test.ts`
- Modify: `packages/contracts/src/index.ts` (kind + `AutomationManipulatorConfigSchema`), `packages/contracts/src/ports.ts`
- Modify: `apps/runtime/src/automation/automation-engine.service.ts` (novo `case 'manipulator'`)
- Modify: `apps/api/src/modules/playbooks/compiler.ts`
- Modify: `apps/web/src/features/playbooks/PlaybookEditorPage.tsx`, `flow-builder.css`
- Modify: `apps/api/src/modules/imports/converter.ts`

**Interfaces:**
- Produz: `applyManipulation(current: unknown, operation: Operation, operand: string): {ok:true; value:unknown} | {ok:false; reason:string}` e `parseTarget(target: string): {scope:'contact'|'flow'; path:string} | null`.
- Consome: nada.

- [ ] **Step 1: Testes das operações**

```ts
expect(applyManipulation(undefined,'add','1')).toEqual({ok:true, value:1});       // ausente começa em zero
expect(applyManipulation(2,'multiply','3')).toEqual({ok:true, value:6});
expect(applyManipulation(undefined,'multiply','3').ok).toBe(false);               // exige valor existente
expect(applyManipulation(4,'divide','0').ok).toBe(false);                         // divisão por zero
expect(applyManipulation('abc','add','1').ok).toBe(false);
expect(applyManipulation(null,'set','{"a":1}')).toEqual({ok:true, value:{a:1}});  // JSON válido
expect(parseTarget('contact.customFields.tentativas')).toEqual({scope:'contact', path:'tentativas'});
expect(parseTarget('_runtime.x')).toBeNull();                                      // reservado
expect(parseTarget('contact.id')).toBeNull();
```

- [ ] **Step 2: Rodar e ver falhar**

- [ ] **Step 3: Implementar `manipulator.ts`**

Nome do campo: 1–60 caracteres, `[A-Za-z0-9_.-]`. Recusar `_runtime`, `contact.id`, `workspace` e qualquer caminho de credencial.

- [ ] **Step 4: Rodar os testes**

- [ ] **Step 5: Contrato, portas e compiler**

Adicionar `'manipulator'` ao `AutomationNodeKindSchema`; `NODE_PORTS.manipulator = ['success','failure']`. Config: `{target, operation, value, failureVariable?}` com `failureVariable` padrão `manipulator.error`. No compiler, exigir alvo e operação válidos; saída de sucesso ausente **encerra o fluxo** (aviso, não erro), seguindo a regra atual.

- [ ] **Step 6: Runtime com transação serializável**

Novo `case 'manipulator'`. Para `contact.customFields.*`, ler e gravar **dentro da mesma transação serializável**, com retry por conflito — reaproveitar `retryTx` já usado pelo Distribuidor. Gravar com `jsonb_set` via `$executeRaw` em tagged template, como o `saveReply` do Aguarda Resposta. Para `flow.*`, alterar só o contexto. O step registra alvo, operação, valor anterior e novo. Falha segue a porta `failure`; sem ela, a execução falha com `MANIPULATOR_FAILED`.

- [ ] **Step 7: Teste de concorrência**

Duas execuções simultâneas de "Somar 1" no mesmo contato resultam em 2, nunca 1.

- [ ] **Step 8: Editor e canvas**

Bloco novo na paleta (ícone `SlidersHorizontal` do lucide). Modal: seletor de destino com os grupos **Campos do contato** e **Variáveis do fluxo**, select de operação (Definir valor, Somar, Subtrair, Multiplicar, Dividir) e campo de valor com seletor `<>`. Canvas: "Definir tentativas = 0", "Somar 1 a tentativas", com as saídas sucesso/erro no padrão da Integração.

- [ ] **Step 9: Importador**

`manipulator` e `save_user_data` isolado viram o bloco novo. Operação desconhecida gera pendência e preserva a config original em `importSource`.

- [ ] **Step 10: Rodar tudo e commitar**

```bash
npm test && npm run typecheck && npm run build -w @nexo/web
git add apps packages
git commit -m "feat: manipulator block with atomic contact field arithmetic"
```

---

### Task 4: Controlador de Chat

**Files:**
- Modify: `packages/contracts/src/index.ts` (`AutomationHandoffConfigSchema`)
- Modify: `apps/runtime/src/automation/automation-engine.service.ts` (`case 'handoff'`, linha ~441)
- Modify: `apps/api/src/modules/playbooks/compiler.ts`
- Modify: `apps/web/src/features/playbooks/PlaybookEditorPage.tsx`, `flow-builder.css`
- Modify: `apps/api/src/modules/imports/converter.ts`
- Test: `apps/runtime/src/automation/chat-controller.test.ts` (novo)

**Interfaces:**
- Consome: o evento `automation.channel_slot.requested` com `payload.slot`, já usado pelo `case 'outcome'` (linha ~460) para `CONVERSATION_RESOLVED`.
- Produz: config `{state, departmentId?, assigneeId?, reason?, returnToAi?}` que a Task 5 passa a resolver por ID.

- [ ] **Step 1: Teste da matriz de transições**

Três estados × efeito na conversa, mais: evento `CONVERSATION_RESOLVED` dispara **uma única vez** quando a conversa ainda não estava resolvida; reexecução não duplica; sair de `HUMAN` dispara `HANDOFF_CLOSED`.

- [ ] **Step 2: Rodar e ver falhar**

- [ ] **Step 3: Contrato com normalização**

`AutomationHandoffConfigSchema` ganha `state: 'AWAITING'|'ATTENDING'|'RESOLVED'` com `z.preprocess` que normaliza a config antiga `{queue, reason}` para `{state:'ATTENDING', queue, reason}`. O kind continua `handoff`.

- [ ] **Step 4: Runtime**

No `case 'handoff'`, aplicar por estado, tudo na mesma transação (conversa + step + execução + outbox):
- **AWAITING:** `mode='HUMAN'`, `status='QUEUED'`, limpa responsável quando não configurado.
- **ATTENDING:** `mode='HUMAN'`, `status = assigneeId ? 'ASSIGNED' : 'QUEUED'`.
- **RESOLVED:** `status='RESOLVED'`, `resolvedAt=now`, `unreadCount=0`, e o outbox `automation.channel_slot.requested` com `slot:'CONVERSATION_RESOLVED'` só se a conversa ainda não estava resolvida.

Terminal por padrão. `returnToAi:true` só é aceito em AWAITING e expõe a saída de sucesso.

- [ ] **Step 5: Rodar os testes**

- [ ] **Step 6: Editor**

Renomear para **Controlador de Chat** no editor e na paleta, mantendo o kind. Select de estado com a explicação do efeito; fila, responsável e motivo aparecem só em Atendimento. Canvas: "Mover chat para Aguardando/Atendimento/Resolvido".

- [ ] **Step 7: Importador**

Mapear `chat_controller` do Leona para os três estados. Handoff antigo continua abrindo.

- [ ] **Step 8: Rodar tudo e commitar**

```bash
npm test && npm run typecheck && npm run build -w @nexo/web
git add apps packages
git commit -m "feat: chat controller block with awaiting, attending and resolved states"
```

---

### Task 5: Departamento por lista

**Files:**
- Create: `apps/api/prisma/migrations/20261022120000_conversation_department/migration.sql`
- Modify: `apps/api/prisma/schema.prisma` (`Conversation.departmentId`)
- Modify: `apps/runtime/src/automation/automation-engine.service.ts` (`case 'assign'` e `handoff`)
- Modify: `apps/web/src/features/playbooks/PlaybookEditorPage.tsx`
- Test: `apps/api/src/modules/playbooks/department-migration.test.ts` (novo)

**Interfaces:**
- Consome da Task 4: a config do Controlador de Chat, que passa a usar `departmentId`/`assigneeId`.
- Produz: `Conversation.departmentId` usado pela listagem do inbox.

- [ ] **Step 1: Migration**

Adicionar `departmentId String?` com FK para `Department` e índice. No mesmo arquivo, associar por nome **apenas quando houver correspondência única e ativa**, sem diferenciar caixa:

```sql
UPDATE "Conversation" c SET "departmentId" = d.id
FROM "Department" d
WHERE d."workspaceId" = c."workspaceId"
  AND lower(d.name) = lower(c.queue)
  AND d."isActive"
  AND (SELECT count(*) FROM "Department" x
       WHERE x."workspaceId" = c."workspaceId" AND lower(x.name) = lower(c.queue) AND x."isActive") = 1;
```

`queue` permanece como snapshot de compatibilidade.

- [ ] **Step 2: Teste da migração**

Nome único associa; nome ambíguo e inexistente mantêm `queue` e deixam `departmentId` nulo.

- [ ] **Step 3: Aplicar a migration localmente**

`npm run db:migrate -w @nexo/api` (banco docker `infra-postgres-1`, usuário/base `nexo`).

- [ ] **Step 4: Config dos blocos por ID**

Departamento e Controlador de Chat passam a usar `{departmentId?, assigneeId?}`, com ao menos um obrigatório. Config antiga com `config.queue` é normalizada no editor **só** quando encontrar departamento único; sem correspondência, mantém o texto legado e mostra pendência.

- [ ] **Step 5: Selects no editor**

Reusar `GET /v1/workspace/departments` com membros ativos. Select de departamento com cor, nome e estado; select de responsável filtrado pelos membros do departamento, com "qualquer atendente". Departamento inativo continua visível numa config antiga, desabilitado e com aviso.

- [ ] **Step 6: Runtime**

Resolver departamento e membership **no momento da execução**, sempre pelo workspace. Atualizar `departmentId`, `queue` com o nome atual, `assigneeId` e o status coerente. Referência inválida usa a saída de erro quando existir; senão falha com mensagem clara.

- [ ] **Step 7: Rodar tudo e commitar**

```bash
npm test && npm run typecheck && npm run build -w @nexo/web
git add apps
git commit -m "feat: department and assignee selected by id instead of free text"
```

---

### Task 6: Arquivar e desarquivar fluxo

**Files:**
- Create: `apps/api/prisma/migrations/20261022130000_playbook_archived_at/migration.sql`
- Modify: `apps/api/prisma/schema.prisma` (`Playbook.archivedAt`)
- Modify: `apps/api/src/modules/playbooks/routes.ts`
- Modify: `apps/web/src/features/playbooks/PlaybooksPage.tsx`, `PlaybookEditorPage.tsx`, `flows-list.ts`
- Test: `apps/api/src/modules/playbooks/archive-route.test.ts` (novo)

**Interfaces:**
- Produz: `GET /v1/playbooks/:id/archive-impact`, `POST /v1/playbooks/:id/archive`, `POST /v1/playbooks/:id/unarchive`.
- Consome: `ChannelFlowConfig` e `ChannelKeyword` da Fase 1, para detectar uso.

- [ ] **Step 1: Testes das rotas**

Matriz de transições (`DRAFT|PAUSED|PUBLISHED -> ARCHIVED`, `ARCHIVED -> DRAFT`); execução `RUNNING`/`WAITING` bloqueia com **409**; outros usos exigem `{confirmDetach:true}`; arquivado não pode ser publicado, pausado, destino de jump, webhook, slot ou palavra-chave.

- [ ] **Step 2: Rodar e ver falhar**

- [ ] **Step 3: Migration e schema**

`archivedAt DateTime?` em `Playbook`. O enum já tem `ARCHIVED`.

- [ ] **Step 4: Rota de impacto**

`archive-impact` retorna: slots e palavras-chave de canais, inbound webhooks, Conexão de Fluxo em versões ativas (varrer a definição JSON procurando `kind:'flow_jump'` com `targetPlaybookId`) e contagem de execuções ativas.

- [ ] **Step 5: Arquivar e desarquivar**

`archive` com `{confirmDetach}` remove as configurações diretas na mesma transação e registra no audit. Flow jumps **não** são reescritos: passam a aparecer inválidos no fluxo de origem. `unarchive` sempre volta para `DRAFT`, preservando o histórico de versões.

- [ ] **Step 6: Frontend**

Ação **Arquivar** no menu ⋯, com modal listando os impactos antes de confirmar. Filtro **Arquivados** separado; "Todos" não inclui arquivados. Editor de fluxo arquivado abre somente leitura, com banner e botão Desarquivar. Seletores de destino (Conexão de Fluxo, slots) filtram arquivados.

- [ ] **Step 7: Rodar tudo e commitar**

```bash
npm test && npm run typecheck && npm run build -w @nexo/web
git add apps
git commit -m "feat: archive and unarchive playbooks with dependency impact check"
```

---

### Task 7: Mensagem — contato e sticker

**Files:**
- Modify: `packages/contracts/src/index.ts` (itens da sequência, linha ~83)
- Create: `packages/domain/src/vcard.ts`, `packages/domain/src/vcard.test.ts`
- Modify: `apps/runtime/src/whatsapp/` (envio) e `automation-engine.service.ts`
- Modify: `apps/web/src/features/playbooks/PlaybookEditorPage.tsx`
- Modify: `apps/api/src/modules/imports/converter.ts`

**Interfaces:**
- Produz: `buildVCard({name, phone}): string` e os itens `{type:'contact'}` / `{type:'sticker'}` na sequência.
- Consome: o cursor de ordem da spec C, já implementado.

- [ ] **Step 1: Teste do vCard**

Escapar `;`, `,`, `\` e quebras de linha; telefone normalizado para E.164; vCard 3.0 válido.

- [ ] **Step 2: Rodar e ver falhar**

- [ ] **Step 3: Implementar o vCard e os itens do contrato**

`contact`: `{type:'contact', name, phone}`, ambos aceitando variáveis. `sticker`: `{type:'sticker', url}`, asset privado ou HTTPS, WebP até 10 MB. `typingSeconds`: `0` desliga; ligado aceita 3–60. Limite da sequência continua em 30 itens.

- [ ] **Step 4: Envio no Baileys**

Contato: `{contacts:{displayName, contacts:[{displayName, vcard}]}}`. Sticker: bytes WebP em `{sticker: buffer}`. Toda mensagem de texto enviada já guarda `externalId` (necessário para a Task 8).

- [ ] **Step 5: Editor**

Botões **+ Contato** e **+ Sticker** na sequência; o "digitando" vira slider com "Desligado" ou 3–60 s. O preview do canvas conta todos os conteúdos.

- [ ] **Step 6: Importador**

`contact` e `sticker` entram na ordem original. Sticker hospedado no CDN do Leona gera aviso para substituir por upload local.

- [ ] **Step 7: Rodar tudo e commitar**

```bash
npm test && npm run typecheck && npm run build -w @nexo/web
git add apps packages
git commit -m "feat: contact and sticker items in the message sequence"
```

---

### Task 8: Apagar mensagem ao aplicar etiqueta

**Files:**
- Create: `apps/api/prisma/migrations/20261022140000_message_deletion_rule/migration.sql`
- Modify: `apps/api/prisma/schema.prisma` (`MessageDeletionRule`)
- Modify: `apps/runtime/src/automation/automation-engine.service.ts` (`case 'tag'`), `runtime-workers.service.ts`, envio no Baileys
- Modify: `apps/web/src/features/playbooks/PlaybookEditorPage.tsx`

**Interfaces:**
- Consome da Task 7: `externalId` guardado em toda mensagem de texto enviada.
- Produz: evento de outbox `message.delete.requested`.

- [ ] **Step 1: Teste da regra**

Idempotência (aplicar a etiqueta duas vezes não repete a exclusão), janela expirada marca `FAILED` sem falhar o bloco Etiqueta, e etiqueta de outro workspace é ignorada.

- [ ] **Step 2: Migration**

`MessageDeletionRule {messageId, contactId, tagId, status, deletedAt?, error?}`, único por `(messageId, tagId)`.

- [ ] **Step 3: Criar a regra no envio**

Item de texto com `deleteOnTagId` cria a regra **somente após o status `SENT`**.

- [ ] **Step 4: Disparar ao aplicar a etiqueta**

No `case 'tag'` (modo `add`): localizar regras pendentes do contato/tag e enfileirar `message.delete.requested` com idempotência. Remover a etiqueta não restaura a mensagem.

- [ ] **Step 5: Worker do Baileys**

Enviar delete para todos usando `remoteJid`, `fromMe:true` e `externalId`. Falha por janela expirada marca `FAILED`.

- [ ] **Step 6: Editor**

No item de texto, toggle **Apagar ao aplicar etiqueta** com seletor de etiqueta.

- [ ] **Step 7: Rodar tudo e commitar**

```bash
npm test && npm run typecheck && npm run build -w @nexo/web
git add apps
git commit -m "feat: delete a sent message when a tag is applied"
```

---

### Task 9: Motor de simulação puro

**Files:**
- Create: `packages/domain/src/simulation.ts`, `packages/domain/src/simulation.test.ts`

**Interfaces:**
- Produz: `createSimulation(definition, variables): SimulationState` e `stepSimulation(state, input): SimulationState`, onde `input` é `{kind:'start'} | {kind:'reply', text} | {kind:'choice', optionId} | {kind:'advance'} | {kind:'port', nodeId, port}`. `SimulationState` traz `{messages[], activeNodeId, visitedNodeIds[], waiting, completed, error?, steps}`.
- Consome: `selectNextEdge`, `renderTemplate`, `conditionMatches` — hoje em `apps/runtime/src/automation/routing.ts` e `packages/contracts/src/conditions.ts`. **Não duplicar:** mover o que for preciso para `packages/domain` e reexportar, mantendo o runtime funcionando.

- [ ] **Step 1: Testes do motor**

Menu com escolha, Aguarda Resposta com resposta e com timeout, condição nos dois caminhos, delay com `advance`, salto de fluxo, término por Handoff/Resultado, limite de 200 passos e de 100 mensagens.

- [ ] **Step 2: Rodar e ver falhar**

- [ ] **Step 3: Implementar o motor**

Puro: sem Prisma, sem Redis, sem rede, sem `Date.now()` fora de um relógio injetável. IA, Integração e Pixel devolvem um cartão "Simulado" e a saída vem de `input.port`. Manipulador (Task 3) altera só o contexto em memória.

- [ ] **Step 4: Rodar os testes**

- [ ] **Step 5: Teste que prova isolamento**

Um teste que injeta adapters que lançam exceção em qualquer escrita e percorre um fluxo inteiro sem disparar nenhuma.

- [ ] **Step 6: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): pure flow simulation engine with in-memory adapters"
```

---

### Task 10: Sessões e API do simulador

**Files:**
- Create: `apps/api/src/modules/playbooks/simulation/routes.ts`, `sessions.ts`, `routes.test.ts`
- Modify: `apps/api/src/modules/playbooks/routes.ts` (registrar)

**Interfaces:**
- Consome da Task 9: `createSimulation`, `stepSimulation`.
- Produz: os 5 endpoints da spec L, cada resposta com `{messages, activeNodeId, visitedNodeIds, waiting, completed, error?}`.

- [ ] **Step 1: Testes das rotas**

Sessão de um usuário não é acessível por outro do mesmo workspace; expiração em 30 min; definição inválida bloqueia o início; limites de passos e mensagens.

- [ ] **Step 2: Rodar e ver falhar**

- [ ] **Step 3: Sessões no Redis**

Chave por `simulationId`, TTL de 30 min, guardando definição **não salva**, contexto, nó atual, espera pendente, histórico e caminho. Exigir `playbook.write`.

- [ ] **Step 4: Rotas**

`POST /v1/playbooks/:id/simulation-sessions`, `.../:simulationId/messages`, `.../advance`, `.../restart`, `DELETE .../:simulationId`.

- [ ] **Step 5: Ações reais opcionais**

Toggle `liveActions`, desligado por padrão. Quando ligado, só IA e Integração executam de verdade, com credenciais do servidor que nunca voltam ao browser, e registram custo e auditoria. Pixel, WhatsApp, Venda e Notificação **nunca** executam. Nenhum contato é alterado.

- [ ] **Step 6: Rodar tudo e commitar**

```bash
npm test && npm run typecheck
git add apps
git commit -m "feat(api): ephemeral flow simulation sessions"
```

---

### Task 11: Painel do simulador no editor

**Files:**
- Create: `apps/web/src/features/playbooks/SimulatorPanel.tsx`
- Modify: `apps/web/src/features/playbooks/PlaybookEditorPage.tsx`, `flow-builder.css`, `api/queries.ts`
- Test: `apps/web/src/features/playbooks/simulator.test.ts`

**Interfaces:**
- Consome da Task 10: os 5 endpoints.

- [ ] **Step 1: Teste do painel**

Resposta do servidor vira balões na ordem certa; `waiting` habilita o composer; `completed` mostra o motivo do término; erro aponta o bloco.

- [ ] **Step 2: Rodar e ver falhar**

- [ ] **Step 3: Painel de chat**

O botão **Simular** abre um painel lateral com aparência de conversa: balões do fluxo e composer para digitar como cliente. Botões do menu aparecem clicáveis. Aguarda Resposta com timeout mostra **Pular para "não respondeu"**; Delay mostra **Pular espera**. Botões Reiniciar e Fechar.

- [ ] **Step 4: Canvas**

Destacar o nó ativo e o caminho visitado **sem marcar o fluxo como alterado**. Clicar no erro centraliza o canvas no bloco.

- [ ] **Step 5: Avançado**

Recolhido: JSON de variáveis iniciais (o campo de hoje), saídas simuladas de Integração/IA e o toggle de execução real com confirmação por sessão.

- [ ] **Step 6: Responsivo**

Em 390 px o painel ocupa a tela; no desktop é lateral e redimensionável. Verificar 390 e 768 px sem rolagem horizontal.

- [ ] **Step 7: Aceite**

Percorrer o GELATINA-FUNIL-01 inteiro digitando as respostas, sem nenhuma mensagem real e sem salvar versão.

- [ ] **Step 8: Rodar tudo e commitar**

```bash
npm test && npm run typecheck && npm run build -w @nexo/web
git add apps
git commit -m "feat(web): chat simulator panel in the flow editor"
```
