# B — Aguarda Resposta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bloco `wait_response` que pausa a execução até o contato responder (porta `reply`) ou até expirar (porta `timeout`), com buffer opcional que junta mensagens.

**Architecture:** Reaproveita a espera/retomada do Menu, generalizada: o contexto guarda `_runtime.pendingWait { stepId, nodeId, kind: 'menu' | 'reply', since }`; jobs `menu_reply`/`menu_timeout` passam a significar "resposta"/"expiração" de qualquer espera. Execuções antigas com `_runtime.pendingMenu` continuam sendo lidas. A lógica pura (tempo de espera, junção de mensagens, compatibilidade) fica em `apps/runtime/src/automation/wait-response.ts`, testada isoladamente.

**Tech Stack:** TypeScript, zod (`@nexo/contracts`), NestJS + BullMQ + Prisma (runtime), React + @xyflow/react (web), vitest.

**Spec:** `docs/superpowers/specs/2026-10-15-b-wait-response-design.md`

## Global Constraints

- Tempo máximo de espera: **31 dias** (`2_678_400` s). `waitIndefinitely` usa esse limite e termina a execução **sem erro** ao atingi-lo.
- Unidades: `minutes` | `hours` | `days`.
- `bufferSeconds`: 0 (desligado) a 300; 0 é o padrão.
- Portas do bloco: `reply` (obrigatória) e `timeout` (opcional; **inválida** quando `waitIndefinitely`).
- Sem conexão em `timeout`: a jornada termina sem erro (como o Menu).
- Variáveis gravadas na resposta: `last_message` (textos juntados com `\n`; legenda da mídia conta como texto) e `last_message_type` (`TEXT` | `IMAGE` | `DOCUMENT` | `AUDIO` | `VIDEO`, da **última** mensagem).
- Resposta que chega depois do timeout é ignorada.
- O web **não** importa `@nexo/contracts` em valores (só tipos) — constantes ficam espelhadas no editor.
- Testes do Menu existentes continuam verdes.
- Textos de UI em português.

---

### Task 1: Contrato e compiler do `wait_response`

**Files:**
- Modify: `packages/contracts/src/index.ts` (linha ~52 `AutomationNodeKindSchema`, perto do schema do Menu)
- Modify: `packages/contracts/src/ports.ts`
- Modify: `apps/api/src/modules/playbooks/compiler.ts` (`validateNodeConfig` switch ~linha 55, `portIssues` ~74, simulação ~211)
- Test: `apps/api/src/modules/playbooks/compiler.test.ts`

**Interfaces:**
- Produces: `AutomationWaitResponseConfigSchema`, `WAIT_MAX_SECONDS = 2_678_400`, `WAIT_MAX_BUFFER_SECONDS = 300` (exportados de `@nexo/contracts`); `NODE_PORTS.wait_response = ['reply', 'timeout']`.

- [ ] **Step 1: Testes que falham** — adicionar ao `compiler.test.ts`:

```ts
const waitDefinition = (config: Record<string, unknown>, edges: Array<Record<string, unknown>>) => ({
  start: 'start',
  nodes: [
    { id: 'start', kind: 'trigger', name: 'Início', config: {}, position: { x: 0, y: 0 } },
    { id: 'wait', kind: 'wait_response', name: 'Aguarda', config, position: { x: 100, y: 0 } },
    { id: 'ok', kind: 'outcome', name: 'Ok', config: { type: 'RESOLVED' }, position: { x: 200, y: 0 } },
    { id: 'late', kind: 'handoff', name: 'Sem resposta', config: {}, position: { x: 200, y: 100 } }
  ],
  edges: [{ id: 'e1', source: 'start', target: 'wait' }, ...edges],
  settings: { maxSteps: 10, timeoutSeconds: 60 }
});

describe('wait_response', () => {
  it('aceita resposta + timeout', () => {
    const result = validateAutomation(waitDefinition({ timeoutValue: 2, timeoutUnit: 'hours' }, [
      { id: 'r', source: 'wait', target: 'ok', port: 'reply' },
      { id: 't', source: 'wait', target: 'late', port: 'timeout' }
    ]));
    expect(result.issues.filter(issue => issue.level === 'error')).toEqual([]);
  });
  it('exige a saída de resposta', () => {
    const result = validateAutomation(waitDefinition({ timeoutValue: 2, timeoutUnit: 'hours' }, [{ id: 't', source: 'wait', target: 'late', port: 'timeout' }]));
    expect(result.issues.map(issue => issue.code)).toContain('REPLY_ROUTE_REQUIRED');
  });
  it('rejeita timeout quando espera indefinidamente', () => {
    const result = validateAutomation(waitDefinition({ waitIndefinitely: true }, [
      { id: 'r', source: 'wait', target: 'ok', port: 'reply' },
      { id: 't', source: 'wait', target: 'late', port: 'timeout' }
    ]));
    expect(result.issues.map(issue => issue.code)).toContain('TIMEOUT_ROUTE_INVALID');
  });
  it('rejeita espera acima de 31 dias e buffer acima de 300 s', () => {
    expect(validateAutomation(waitDefinition({ timeoutValue: 32, timeoutUnit: 'days' }, [{ id: 'r', source: 'wait', target: 'ok', port: 'reply' }])).issues.map(issue => issue.code)).toContain('INVALID_WAIT_RESPONSE_CONFIG');
    expect(validateAutomation(waitDefinition({ timeoutValue: 1, timeoutUnit: 'days', bufferSeconds: 301 }, [{ id: 'r', source: 'wait', target: 'ok', port: 'reply' }])).issues.map(issue => issue.code)).toContain('INVALID_WAIT_RESPONSE_CONFIG');
  });
  it('rejeita conexão sem porta saindo do bloco', () => {
    const result = validateAutomation(waitDefinition({ timeoutValue: 1, timeoutUnit: 'days' }, [{ id: 'r', source: 'wait', target: 'ok' }]));
    expect(result.issues.map(issue => issue.code)).toContain('EDGE_PORT_INVALID');
  });
  it('a simulação segue a saída de resposta', () => {
    const simulation = simulateAutomation(waitDefinition({ timeoutValue: 1, timeoutUnit: 'days' }, [
      { id: 'r', source: 'wait', target: 'ok', port: 'reply' },
      { id: 't', source: 'wait', target: 'late', port: 'timeout' }
    ]));
    expect(simulation.steps.map(step => step.nodeId)).toEqual(['start', 'wait', 'ok']);
  });
});
```

Ajuste a chamada de `simulateAutomation` à assinatura real do arquivo (veja os testes de simulação existentes) se ela receber variáveis.

- [ ] **Step 2: Rodar e ver falhar** — `npm test -w apps/api -- compiler` → FAIL (kind desconhecido).

- [ ] **Step 3: Implementar**

Em `ports.ts`:
```ts
export const NODE_PORTS: Readonly<Partial<Record<string, readonly EdgePort[]>>> = {
  webhook: ['success', 'failure'],
  ai: ['success', 'failure'],
  wait_response: ['reply', 'timeout']
};
```
O primeiro item de cada lista é a saída obrigatória.

Em `index.ts`: incluir `'wait_response'` no `AutomationNodeKindSchema` e, no estilo compacto do arquivo:
```ts
export const WAIT_MAX_SECONDS=2_678_400;
export const WAIT_MAX_BUFFER_SECONDS=300;
export const WAIT_UNIT_SECONDS={minutes:60,hours:3_600,days:86_400} as const;
export const AutomationWaitResponseConfigSchema=z.object({
  waitIndefinitely:z.boolean().default(false),
  timeoutValue:z.number().int().min(1).optional(),
  timeoutUnit:z.enum(['minutes','hours','days']).default('hours'),
  bufferSeconds:z.number().int().min(0).max(WAIT_MAX_BUFFER_SECONDS).default(0)
}).superRefine((value,ctx)=>{
  if(value.waitIndefinitely)return;
  if(value.timeoutValue===undefined){ctx.addIssue({code:z.ZodIssueCode.custom,path:['timeoutValue'],message:'Informe o tempo de espera.'});return}
  if(value.timeoutValue*WAIT_UNIT_SECONDS[value.timeoutUnit]>WAIT_MAX_SECONDS)ctx.addIssue({code:z.ZodIssueCode.custom,path:['timeoutValue'],message:'A espera máxima é de 31 dias.'});
});
```

Em `compiler.ts`:
- `validateNodeConfig`: `case 'wait_response': return validateConfig(AutomationWaitResponseConfigSchema, 'INVALID_WAIT_RESPONSE_CONFIG', 'Aguarda Resposta inválido');`
- `portIssues`: trocar o teste fixo de `success` pela primeira porta do bloco, mantendo o código `SUCCESS_ROUTE_REQUIRED` para webhook/ai:
```ts
  const required = ports[0]!;
  if (edges.length && !used.has(required)) issues.push(required === 'reply' ? error('REPLY_ROUTE_REQUIRED', 'Ligue a saída de resposta.') : error('SUCCESS_ROUTE_REQUIRED', 'Ligue a saída de sucesso.'));
```
- Depois de `portIssues` no loop dos nós: se `node.kind === 'wait_response' && node.config.waitIndefinitely === true`, cada aresta com `edgePort(edge) === 'timeout'` gera `error('TIMEOUT_ROUTE_INVALID', 'Sem tempo limite, o bloco não tem saída de timeout.')` com `edgeId`.
- Simulação: `if (nodePorts(node.kind).length) selected = candidates.find(edge => edgePort(edge) === nodePorts(node.kind)[0]);`

- [ ] **Step 4: Rodar** — `npm test -w apps/api` e `npm run typecheck -w apps/api` → PASS. Rode também `npm run typecheck -w apps/runtime` e `-w apps/web`: se algum `switch`/`Record` exaustivo sobre o tipo de nó quebrar, adicione a entrada mínima (o caso real do runtime vem na Task 3; o do web na Task 4).

- [ ] **Step 5: Commit** — `feat(contracts): wait_response node with reply/timeout ports and compiler rules`

---

### Task 2: Lógica pura da espera

**Files:**
- Create: `apps/runtime/src/automation/wait-response.ts`
- Test: `apps/runtime/src/automation/wait-response.test.ts`

**Interfaces:**
- Consumes: `WAIT_MAX_SECONDS`, `WAIT_UNIT_SECONDS` de `@nexo/contracts`.
- Produces:
  - `type PendingWait = { stepId: string; nodeId: string; kind: 'menu' | 'reply'; since?: string }`
  - `pendingWaitOf(runtime: unknown): PendingWait | undefined` — lê `pendingWait`, ou converte o legado `pendingMenu { stepId, nodeId }` em `kind: 'menu'`.
  - `waitTimeoutSeconds(config: Record<string, unknown>): { seconds: number; endsWithoutTimeoutRoute: boolean }` — `waitIndefinitely` ou config inválida → `{ seconds: WAIT_MAX_SECONDS, endsWithoutTimeoutRoute: true }`; senão `min(valor × unidade, WAIT_MAX_SECONDS)` com `false`.
  - `waitBufferSeconds(config): number` — inteiro 0–300, inválido → 0.
  - `joinReplies(messages: Array<{ body: string | null; type: string }>): { last_message: string; last_message_type: string }` — corpos não vazios juntados com `\n`; tipo da última mensagem; lista vazia → `{ last_message: '', last_message_type: 'TEXT' }`.

- [ ] **Step 1: Testes**

```ts
import { describe, expect, it } from 'vitest';
import { joinReplies, pendingWaitOf, waitBufferSeconds, waitTimeoutSeconds } from './wait-response.js';

describe('wait-response', () => {
  it('converte tempo + unidade e respeita 31 dias', () => {
    expect(waitTimeoutSeconds({ timeoutValue: 2, timeoutUnit: 'hours' })).toEqual({ seconds: 7_200, endsWithoutTimeoutRoute: false });
    expect(waitTimeoutSeconds({ timeoutValue: 90, timeoutUnit: 'days' }).seconds).toBe(2_678_400);
  });
  it('esperar indefinidamente usa o limite técnico e termina sem erro', () => {
    expect(waitTimeoutSeconds({ waitIndefinitely: true, timeoutValue: 1, timeoutUnit: 'minutes' })).toEqual({ seconds: 2_678_400, endsWithoutTimeoutRoute: true });
  });
  it('buffer fora da faixa vira desligado', () => {
    expect(waitBufferSeconds({ bufferSeconds: 30 })).toBe(30);
    expect(waitBufferSeconds({ bufferSeconds: 999 })).toBe(0);
    expect(waitBufferSeconds({})).toBe(0);
  });
  it('junta as mensagens do buffer e usa o tipo da última', () => {
    expect(joinReplies([{ body: 'oi', type: 'TEXT' }, { body: 'segue o comprovante', type: 'TEXT' }, { body: null, type: 'IMAGE' }]))
      .toEqual({ last_message: 'oi\nsegue o comprovante', last_message_type: 'IMAGE' });
  });
  it('lê a espera nova e a do Menu antigo', () => {
    expect(pendingWaitOf({ pendingWait: { stepId: 's', nodeId: 'n', kind: 'reply', since: '2026-10-15T00:00:00.000Z' } })?.kind).toBe('reply');
    expect(pendingWaitOf({ pendingMenu: { stepId: 's', nodeId: 'n' } })).toEqual({ stepId: 's', nodeId: 'n', kind: 'menu' });
    expect(pendingWaitOf({})).toBeUndefined();
  });
});
```

- [ ] **Step 2:** `npm test -w apps/runtime -- wait-response` → FAIL.
- [ ] **Step 3:** Implementar `wait-response.ts` com exatamente essas funções (validação defensiva de `unknown`, sem dependências além do contrato).
- [ ] **Step 4:** `npm test -w apps/runtime` e `npm run typecheck -w apps/runtime` → PASS.
- [ ] **Step 5: Commit** — `feat(runtime): pure wait-response helpers`

---

### Task 3: Engine e workers — esperar, retomar, expirar

**Files:**
- Modify: `apps/runtime/src/automation/automation-engine.service.ts`
- Modify: `apps/runtime/src/runtime-workers.service.ts` (`resumeWaitingMenu` ~174, chamada ~144)

**Interfaces:**
- Consumes: helpers da Task 2; `NODE_PORTS`/`selectPortEdge`/`setContextPath` existentes.
- Produces: execuções em `WAITING` com `_runtime.pendingWait`; jobs `menu_reply`/`menu_timeout` valem para qualquer espera (comentar isso no tipo `AutomationJob`).

Comportamento exigido:

1. **Gravar a espera em formato novo.** O Menu passa a gravar `_runtime: { pendingWait: { stepId, nodeId, kind: 'menu' } }` (era `pendingMenu`). Todo ponto que lê `pendingMenu` (checagem `menuDue` em `executeLocked`, o bloco `if (execution.status === 'WAITING')`, `resumeWaitingMenu` no worker) passa a usar `pendingWaitOf(context._runtime)`, que aceita os dois formatos. Remover o tipo `PendingMenu` em favor de `PendingWait`.

2. **Novo `case 'wait_response'` em `runNode`.** Em uma transação: step continua `RUNNING` com `output { waitingForReply: true }`; execução `WAITING`, `currentNode: node.id`, contexto `{ ...context, _runtime: { pendingWait: { stepId: step.id, nodeId: node.id, kind: 'reply', since: new Date().toISOString() } } }`. Depois agendar o timeout igual ao Menu, com `delay: waitTimeoutSeconds(node.config).seconds * 1000` e `jobId: automation-wait-timeout-${executionId}-${step.id}`; falha ao agendar → `failExecution(executionId, 'WAIT_TIMEOUT_SCHEDULING_FAILED', …)` e relança. Retorna `'waiting'`.

3. **Retomada.** `resumeMenu` vira `resumeWait`, despachando por `pending.kind`: `'menu'` mantém exatamente a lógica atual; `'reply'` chama um novo `resumeReply`:
   - `menu_timeout`: step `SUCCEEDED` com `output { timedOut: true }`; segue `selectPortEdge(edges, nodeId, 'timeout')`. Sem aresta, ou `waitTimeoutSeconds(config).endsWithoutTimeoutRoute`: execução `SUCCEEDED`, `currentNode: null`, `finishedAt`, e retorna `null`.
   - `menu_reply`: carrega as mensagens `INBOUND` da conversa com `createdAt >= pending.since` (ordem crescente, `select { id, body, type }`). Nenhuma → retorna `null` (continua esperando). Senão `joinReplies(...)` → grava `last_message` e `last_message_type` no contexto, step `SUCCEEDED` com `output { messageIds, last_message_type }`, segue `selectPortEdge(edges, nodeId, 'reply')`; sem aresta → `failExecution(…, 'DEAD_END', …)` e `null`.
   - Execuções em `pendingWait.kind === 'reply'` sem `since` (não deve ocorrer) usam o `startedAt` do step.

4. **Worker (`resumeWaitingMenu` → `resumeWaitingExecution`).** Usa `pendingWaitOf`. Para `kind: 'menu'` mantém o envio atual (`menu_reply` com `jobOptions` do outbox). Para `kind: 'reply'`: buscar o nó na versão da execução (incluir `playbookVersion: { select: { definition: true } }` no `findFirst`) para ler `waitBufferSeconds(config)`, e enfileirar `menu_reply` com **`jobId: automation-wait-reply-${executionId}-${stepId}`** e `delay: buffer * 1000` (demais opções iguais a `jobOptions`). O `jobId` fixo faz o BullMQ ignorar as mensagens seguintes do buffer; o job lê todas as mensagens desde `since`. Retorna `true` em ambos os casos (a mensagem não inicia nova execução).

5. **Resposta depois do timeout** já é ignorada pela checagem de `stepId` em `executeLocked` (a espera foi limpa) — manter.

- [ ] **Step 1:** Implementar 1–5.
- [ ] **Step 2:** `npm run typecheck -w apps/runtime && npm test -w apps/runtime` → PASS (testes do Menu inclusos).
- [ ] **Step 3:** Revisar à mão os três caminhos (resposta sem buffer, resposta com buffer de 30 s com três mensagens, timeout sem aresta) lendo o código; descrever no relatório o que cada um grava em `Execution`/`ExecutionStep`.
- [ ] **Step 4: Commit** — `feat(runtime): wait_response node waits for reply with buffer and timeout`

---

### Task 4: Editor — bloco "Aguarda Resposta"

**Files:**
- Modify: `apps/web/src/features/playbooks/PlaybookEditorPage.tsx`
- Modify: `apps/web/src/features/playbooks/flow-builder.css`

**Interfaces:**
- Consumes: tipo `AutomationNodeKind` (agora com `'wait_response'`); portas `reply`/`timeout`.

Requisitos:
- `catalog`: `{kind:'wait_response',icon:Hourglass,label:'Aguarda Resposta',description:'Pausa até o contato responder',rule:'Saída de resposta obrigatória; saída de timeout opcional (não existe ao esperar indefinidamente). Espera máxima de 31 dias; junta mensagens por até 300 s.'}` (ícone `Hourglass` do lucide-react), posicionado logo após o Menu interativo.
- Espelho local: `NODE_PORTS` ganha `wait_response:['reply','timeout']`; ajustar o tipo para `Array<'success'|'failure'|'reply'|'timeout'>`; `PORT_LABELS` ganha `reply:'respondeu'`, `timeout:'não respondeu'`; espelhar `WAIT_MAX_SECONDS=2_678_400`, `WAIT_MAX_BUFFER_SECONDS=300` e as unidades. `connectionRule` passa a descrever a porta obrigatória pela primeira porta do bloco. `sourceHandleFor` já devolve `edge.port` para blocos com portas — trocar o padrão `'success'` pela primeira porta do bloco.
- Nó no canvas (cor laranja, tokens do design system — definir `--wait` em `flow-builder.css` claro/escuro): linha "Aguardar pela resposta do cliente." com alça `reply`; linha "Ou caso não responda — Após X {minutos|horas|dias}" com alça `timeout`, **oculta** quando `waitIndefinitely` (nesse caso mostrar "Espera indefinidamente"). Seguir o mesmo padrão de alças por porta já usado em Integração/IA.
- Ao marcar "Esperar indefinidamente", remover do grafo a aresta `timeout` desse nó (evita o erro do compiler).
- Inspector/modal do bloco: tempo (número ≥ 1) + unidade (select Minutos/Horas/Dias), checkbox "Esperar indefinidamente" (desabilita tempo/unidade), "Juntar mensagens por N segundos" (0–300, 0 = desligado), com mensagens de erro inline quando o total passar de 31 dias ou o buffer sair da faixa. Padrão ao criar o bloco: `{timeoutValue:1,timeoutUnit:'hours',waitIndefinitely:false,bufferSeconds:0}`.
- `nodeSummary` para `wait_response`: "Até 2 horas" / "Indefinidamente" (+ " · junta 30 s" quando houver buffer).
- Manter o estilo JSX compacto do arquivo.

- [ ] **Step 1:** Implementar.
- [ ] **Step 2:** `npm run typecheck -w apps/web && npm run build -w apps/web` → PASS (e `npm test -w apps/web` se existir).
- [ ] **Step 3: Commit** — `feat(web): Aguarda Resposta block with reply/timeout exits`
