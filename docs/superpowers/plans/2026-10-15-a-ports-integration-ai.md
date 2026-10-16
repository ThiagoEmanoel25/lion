# A — Portas nomeadas, Integração e IA direta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integração e Bloco de IA ganham saídas "sucesso"/"erro"; o Bloco de IA passa a chamar a OpenAI direto (prompt no bloco, lê imagem/PDF recebidos, grava a resposta em variável), com a chave da OpenAI guardada cifrada no workspace.

**Architecture:** As conexões ganham um campo opcional `port`. Blocos que declaram portas (`webhook`, `ai`) escolhem a porta em tempo de execução e o engine segue a conexão daquela porta. Lógica pura fica em módulos testáveis (`contracts/ports.ts`, `runtime/automation/integration.ts`, `runtime/automation/ai-call.ts`); o engine só orquestra banco e fila. Mídia recebida (imagem/PDF ≤ 10 MB) é baixada pelo Baileys e guardada em `MessageMedia` por 30 dias.

**Tech Stack:** TypeScript, zod, Prisma 6 (Postgres), Fastify (api), NestJS + BullMQ + Baileys (runtime), React 19 + @xyflow/react (web), vitest.

**Spec:** `docs/superpowers/specs/2026-10-15-a-ports-integration-ai-design.md`

## Global Constraints

- Portas: `'success' | 'failure' | 'reply' | 'timeout'`. Nesta spec só `webhook` e `ai` expõem portas, ambos `['success','failure']`.
- Conexão **sem** `port` saindo de `webhook`/`ai` vale como `success` (fluxos atuais continuam iguais).
- Falha sem conexão `failure` → a execução falha com o motivo do bloco (comportamento atual da Integração). Sucesso sem conexão → `DEAD_END`.
- Integração: timeout de **15 s**; sucesso = HTTP 2xx; `responseFields` até **20**; leitura de caminho sobre `{ status, body, headers }`; falha grava `integration.error = { status, message }`.
- IA: timeout **60 s**; padrões `model: 'gpt-5.4-mini'`, `userMessage: '{{last_message}}'`, `responseVariable: 'resposta.gpt'`, `failReasonVariable: 'ai.fail.reason'`, `contextInteractions: 1` (1–20), `understandImage/understandPdf/autoSendResponse: false`.
- Chave da OpenAI: cifrada com o formato `v1.<iv>.<tag>.<dados>` (AES-256-GCM, `FIELD_ENCRYPTION_KEY`), nunca devolvida pela API (só `configured` e `last4`); sem chave no workspace usa `OPENAI_API_KEY`; sem nenhuma → porta `failure` com "Chave da OpenAI não configurada.".
- Mídia recebida: imagem (`imageMessage`) ou documento PDF/imagem (`documentMessage`), **≤ 10 MB** (`10 * 1024 * 1024`), retenção **30 dias**.
- Variáveis novas no contexto: `last_message`, `contact.firstName`, `channel.phone`.
- Clarificação da spec (Ruling do controlador): "mídia exigida e ausente" = a última mensagem recebida **é** imagem/PDF e o bloco lê esse tipo, mas o arquivo não foi guardado (grande demais/erro de download) → `failure` "Arquivo grande demais ou indisponível para a IA.". Se a última mensagem é texto, a IA roda só com o texto.
- O web **não** importa `@nexo/contracts`. Nenhuma dependência nova.
- Testes: `npx vitest run <caminho>` na raiz. Typecheck: `npx tsc --noEmit -p apps/<app>`. Prisma: `npx prisma validate --schema apps/api/prisma/schema.prisma` e `npm run db:generate -w apps/api`. **Não** rodar migrações contra banco.
- Mensagens de commit terminam com a linha de atribuição do agente que commita.

---

### Task 1: Contratos — portas, bloco `ai`, campos da Integração, chave de IA

**Files:**
- Create: `packages/contracts/src/ports.ts`
- Create: `packages/contracts/src/ports.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces: `EDGE_PORTS`, `type EdgePort`, `NODE_PORTS: Readonly<Partial<Record<string, readonly EdgePort[]>>>`, `nodePorts(kind: string): readonly EdgePort[]`, `edgePort(edge: { port?: EdgePort }): EdgePort`, `AutomationAiConfigSchema`, `AutomationResponseFieldSchema`, `SetAiKeyInput`; `AutomationEdgeSchema` com `port?`; `AutomationNodeKindSchema` com `'ai'`; `AutomationWebhookConfigSchema` com `responseFields`.

- [ ] **Step 1: Testes**

`packages/contracts/src/ports.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { edgePort, nodePorts } from './ports.js';
import { AutomationAiConfigSchema, AutomationEdgeSchema, AutomationWebhookConfigSchema, SetAiKeyInput } from './index.js';

describe('ports', () => {
  it('declara portas só para integração e IA', () => {
    expect(nodePorts('webhook')).toEqual(['success', 'failure']);
    expect(nodePorts('ai')).toEqual(['success', 'failure']);
    expect(nodePorts('message')).toEqual([]);
  });

  it('conexão sem porta vale como sucesso', () => {
    expect(edgePort({})).toBe('success');
    expect(edgePort({ port: 'failure' })).toBe('failure');
  });

  it('valida a porta na conexão', () => {
    expect(AutomationEdgeSchema.safeParse({ id: 'e', source: 'a', target: 'b', port: 'failure' }).success).toBe(true);
    expect(AutomationEdgeSchema.safeParse({ id: 'e', source: 'a', target: 'b', port: 'erro' }).success).toBe(false);
  });
});

describe('AutomationAiConfigSchema', () => {
  it('aplica os padrões da Leona', () => {
    const parsed = AutomationAiConfigSchema.parse({ systemPrompt: 'Analise o comprovante.' });
    expect(parsed).toEqual({ model: 'gpt-5.4-mini', systemPrompt: 'Analise o comprovante.', userMessage: '{{last_message}}', understandImage: false, understandPdf: false, responseVariable: 'resposta.gpt', failReasonVariable: 'ai.fail.reason', autoSendResponse: false, contextInteractions: 1 });
  });

  it('exige prompt e limita o contexto', () => {
    expect(AutomationAiConfigSchema.safeParse({ systemPrompt: '' }).success).toBe(false);
    expect(AutomationAiConfigSchema.safeParse({ systemPrompt: 'x', contextInteractions: 21 }).success).toBe(false);
    expect(AutomationAiConfigSchema.safeParse({ systemPrompt: 'x', responseVariable: '1abc' }).success).toBe(false);
  });
});

describe('Integração e chave de IA', () => {
  it('aceita até 20 campos da resposta com variável válida', () => {
    const base = { url: 'https://api.test/x' };
    expect(AutomationWebhookConfigSchema.safeParse({ ...base, responseFields: [{ path: 'body.accepted', variable: 'kovil.receipt.accepted' }] }).success).toBe(true);
    expect(AutomationWebhookConfigSchema.safeParse({ ...base, responseFields: Array.from({ length: 21 }, (_, i) => ({ path: `body.f${i}`, variable: `v${i}` })) }).success).toBe(false);
    expect(AutomationWebhookConfigSchema.safeParse({ ...base, responseFields: [{ path: 'body.x', variable: 'tem espaço' }] }).success).toBe(false);
  });

  it('chave da OpenAI começa com sk-', () => {
    expect(SetAiKeyInput.safeParse({ apiKey: 'sk-proj-0123456789abcdefghij' }).success).toBe(true);
    expect(SetAiKeyInput.safeParse({ apiKey: 'abc' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run packages/contracts/src/ports.test.ts`
Expected: FAIL — `Failed to resolve import "./ports.js"`.

- [ ] **Step 3: `packages/contracts/src/ports.ts`**

```ts
// Named exits of a node. A node kind that declares ports picks one at run time and
// the engine follows the edge with that port.
export const EDGE_PORTS = ['success', 'failure', 'reply', 'timeout'] as const;
export type EdgePort = typeof EDGE_PORTS[number];

export const NODE_PORTS: Readonly<Partial<Record<string, readonly EdgePort[]>>> = {
  webhook: ['success', 'failure'],
  ai: ['success', 'failure']
};

export function nodePorts(kind: string): readonly EdgePort[] {
  return NODE_PORTS[kind] ?? [];
}

// Edges saved before ports existed have no port: they keep meaning "success".
export function edgePort(edge: { port?: EdgePort }): EdgePort {
  return edge.port ?? 'success';
}
```

- [ ] **Step 4: `packages/contracts/src/index.ts`**

1. Junto dos imports/exports de `./conditions.js` no topo:
```ts
import { EDGE_PORTS } from './ports.js';
export * from './ports.js';
```
2. Em `AutomationNodeKindSchema`, acrescentar `'ai'` ao fim da lista do `z.enum([...])`.
3. Logo antes de `export const AutomationWebhookConfigSchema`, adicionar:
```ts
const ContextPathSchema=z.string().trim().min(1).max(120).regex(/^[A-Za-z_][\w.-]*$/,'Use letras, números, _, - e pontos, começando por letra.');
export const AutomationResponseFieldSchema=z.object({path:z.string().trim().min(1).max(200),variable:ContextPathSchema}).strict();
```
4. Em `AutomationWebhookConfigSchema`, acrescentar ao objeto (antes do `}).strict()`): `,responseFields:z.array(AutomationResponseFieldSchema).max(20).default([])`.
5. Depois de `AutomationWebhookConfigSchema`, adicionar:
```ts
export const AutomationAiConfigSchema=z.object({
  model:z.string().trim().min(1).max(60).regex(/^[\w.:-]+$/).default('gpt-5.4-mini'),
  systemPrompt:z.string().trim().min(1).max(12000),
  userMessage:z.string().max(4000).default('{{last_message}}'),
  understandImage:z.boolean().default(false),
  understandPdf:z.boolean().default(false),
  responseVariable:ContextPathSchema.default('resposta.gpt'),
  failReasonVariable:ContextPathSchema.default('ai.fail.reason'),
  autoSendResponse:z.boolean().default(false),
  contextInteractions:z.number().int().min(1).max(20).default(1)
}).strict();
export const SetAiKeyInput=z.object({apiKey:z.string().trim().min(20).max(300).regex(/^sk-/,'A chave da OpenAI começa com sk-.')});
```
6. Em `AutomationEdgeSchema`, acrescentar ao objeto: `,port:z.enum(EDGE_PORTS).optional()`.

- [ ] **Step 5: Rodar**

Run: `npx vitest run packages/contracts && npx tsc --noEmit -p apps/api && npx tsc --noEmit -p apps/runtime`
Expected: PASS; typecheck sem saída (se o tsc apontar `switch` não exaustivo sobre o tipo de nó por causa de `'ai'`, adicione `case 'ai':` retornando `[]`/sem efeito **apenas** para satisfazer o compilador e cite no relatório — as tarefas 2 e 6 implementam o comportamento).

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/ports.ts packages/contracts/src/ports.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): named edge ports, direct AI block config and integration response fields"
```

---

### Task 2: Compiler — validação por porta, config do `ai`, simulação

**Files:**
- Modify: `apps/api/src/modules/playbooks/compiler.ts`
- Modify: `apps/api/src/modules/playbooks/compiler.test.ts`

**Interfaces:**
- Consumes: `nodePorts`, `edgePort`, `AutomationAiConfigSchema` (Task 1).
- Produces: códigos de erro `EDGE_PORT_INVALID`, `PORT_DUPLICATE_ROUTE`, `SUCCESS_ROUTE_REQUIRED`, `INVALID_AI_CONFIG`.

- [ ] **Step 1: Testes** — acrescentar ao fim de `compiler.test.ts`:

```ts
describe('portas de sucesso e erro', () => {
  const ported = (edges: Array<Record<string, unknown>>) => ({
    start: 'start',
    nodes: [
      { id: 'start', kind: 'trigger', name: 'Início', config: {}, position: { x: 0, y: 0 } },
      { id: 'api', kind: 'webhook', name: 'Integração', config: { url: 'https://api.test/x' }, position: { x: 100, y: 0 } },
      { id: 'ok', kind: 'outcome', name: 'Ok', config: { type: 'RESOLVED' }, position: { x: 200, y: 0 } },
      { id: 'bad', kind: 'handoff', name: 'Erro', config: {}, position: { x: 200, y: 100 } }
    ],
    edges: [{ id: 'e0', source: 'start', target: 'api' }, ...edges],
    settings: { maxSteps: 10, timeoutSeconds: 60 }
  });

  it('aceita sucesso e erro, e conexão antiga sem porta', () => {
    expect(validateAutomation(ported([{ id: 's', source: 'api', target: 'ok', port: 'success' }, { id: 'f', source: 'api', target: 'bad', port: 'failure' }])).valid).toBe(true);
    expect(validateAutomation(ported([{ id: 's', source: 'api', target: 'ok' }])).valid).toBe(true);
  });

  it('rejeita porta repetida, porta inexistente e falta de sucesso', () => {
    const codes = (edges: Array<Record<string, unknown>>) => validateAutomation(ported(edges)).issues.map(issue => issue.code);
    expect(codes([{ id: 's', source: 'api', target: 'ok' }, { id: 's2', source: 'api', target: 'bad', port: 'success' }])).toContain('PORT_DUPLICATE_ROUTE');
    expect(codes([{ id: 's', source: 'api', target: 'ok', port: 'reply' }])).toContain('EDGE_PORT_INVALID');
    expect(codes([{ id: 'f', source: 'api', target: 'bad', port: 'failure' }])).toContain('SUCCESS_ROUTE_REQUIRED');
    expect(codes([{ id: 's', source: 'start', target: 'ok', port: 'success' }])).toContain('EDGE_PORT_INVALID');
  });

  it('valida a config do bloco de IA', () => {
    const definition = ported([{ id: 's', source: 'api', target: 'ok' }]);
    definition.nodes[1] = { ...definition.nodes[1]!, kind: 'ai', config: { systemPrompt: '' } } as never;
    expect(validateAutomation(definition).issues.map(issue => issue.code)).toContain('INVALID_AI_CONFIG');
  });

  it('simula seguindo a porta de sucesso', () => {
    const { definition } = validateAutomation(ported([{ id: 'f', source: 'api', target: 'bad', port: 'failure' }, { id: 's', source: 'api', target: 'ok', port: 'success' }]));
    expect(simulateAutomation(definition!).path).toEqual(['start', 'api', 'ok']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run apps/api/src/modules/playbooks/compiler.test.ts` → FAIL nos 4 testes novos.

- [ ] **Step 3: Implementar em `compiler.ts`**

1. Import: acrescentar `AutomationAiConfigSchema`, `edgePort`, `nodePorts` ao import de `@nexo/contracts`.
2. Em `nodeConfigIssues`, novo caso antes do `default`:
```ts
    case 'ai':
      return validateConfig(AutomationAiConfigSchema, 'INVALID_AI_CONFIG', 'Bloco de IA inválido');
```
3. No laço de validação por nó, trocar a linha do `AMBIGUOUS_OUTPUT` por:
```ts
    const ports = nodePorts(node.kind);
    const menuRouted = node.kind === 'buttons' && edges.some(edge => edge.condition !== undefined || edge.isDefault);
    if (node.kind !== 'condition' && !menuRouted && !ports.length && edges.length > 1) issues.push({ level: 'error', code: 'AMBIGUOUS_OUTPUT', message: 'Somente condições, menus e blocos com sucesso/erro podem ter mais de uma saída.', nodeId: node.id });
    if (menuRouted) issues.push(...menuRouteIssues(node, edges));
    issues.push(...portIssues(node, edges, ports));
```
(remova a linha antiga do `if (menuRouted) …` para não duplicar).
4. Nova função ao lado de `menuRouteIssues`:
```ts
// Nodes with named exits: one edge per port, ports must exist on the node, success is mandatory.
function portIssues(node: AutomationDefinition['nodes'][number], edges: AutomationEdge[], ports: readonly string[]): AutomationIssue[] {
  const issues: AutomationIssue[] = [];
  const error = (code: string, message: string, edgeId?: string): AutomationIssue => ({ level: 'error', code, message, nodeId: node.id, ...(edgeId ? { edgeId } : {}) });
  if (!ports.length) {
    for (const edge of edges) if (edge.port) issues.push(error('EDGE_PORT_INVALID', 'Este bloco não tem saídas de sucesso/erro.', edge.id));
    return issues;
  }
  const used = new Set<string>();
  for (const edge of edges) {
    const port = edgePort(edge);
    if (!ports.includes(port)) { issues.push(error('EDGE_PORT_INVALID', `Saída “${port}” não existe neste bloco.`, edge.id)); continue; }
    if (used.has(port)) issues.push(error('PORT_DUPLICATE_ROUTE', 'Cada saída deste bloco aceita uma conexão.', edge.id));
    used.add(port);
  }
  if (edges.length && !used.has('success')) issues.push(error('SUCCESS_ROUTE_REQUIRED', 'Ligue a saída de sucesso.'));
  return issues;
}
```
5. Em `simulateAutomation`, logo após `let selected: AutomationEdge | undefined = candidates[0];`:
```ts
    if (nodePorts(node.kind).length) selected = candidates.find(edge => edgePort(edge) === 'success');
```

- [ ] **Step 4: Rodar** — `npx vitest run apps/api && npx tsc --noEmit -p apps/api` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/playbooks/compiler.ts apps/api/src/modules/playbooks/compiler.test.ts
git commit -m "feat(api): validate success/failure ports and the direct AI block"
```

---

### Task 3: Runtime — Integração com sucesso/erro e campos da resposta

**Files:**
- Create: `apps/runtime/src/automation/integration.ts`
- Create: `apps/runtime/src/automation/integration.test.ts`
- Modify: `apps/runtime/src/automation/routing.ts` (receber `setContextPath`, adicionar `selectPortEdge`)
- Modify: `apps/runtime/src/automation/automation-engine.service.ts` (remover `setContextPath` local, laço aceita `{ next }`, caso `webhook`)

**Interfaces:**
- Consumes: `edgePort` (Task 1).
- Produces (routing.ts): `setContextPath<T extends Record<string, unknown>>(context: T, path: string, value: unknown): T`, `selectPortEdge(edges: AutomationEdge[], nodeId: string, port: EdgePort): AutomationEdge | undefined`.
- Produces (integration.ts): `type ResponseField = { path: string; variable: string }`, `parseResponseFields(value: unknown): ResponseField[]`, `integrationOutcome(input): { port: 'success' | 'failure'; context: Record<string, unknown>; output: Record<string, unknown> }`.
- Produces (engine): `runNode` pode devolver `{ next: string }` — usado também pela Task 6.

- [ ] **Step 1: Testes** — `apps/runtime/src/automation/integration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { integrationOutcome, parseResponseFields } from './integration.js';
import { selectPortEdge, type AutomationEdge } from './routing.js';

const fields = [{ path: 'body.accepted', variable: 'kovil.receipt.accepted' }, { path: 'status', variable: 'kovil.status' }];

describe('integrationOutcome', () => {
  it('sucesso grava campos mapeados, resposta inteira e webhook', () => {
    const result = integrationOutcome({ context: { lead: 1 }, status: 200, body: '{"accepted":true}', responseVariable: 'raw', responseFields: fields });
    expect(result.port).toBe('success');
    expect(result.context).toMatchObject({ lead: 1, raw: { accepted: true }, kovil: { receipt: { accepted: true }, status: 200 }, webhook: { status: 200, body: { accepted: true } } });
  });

  it('HTTP fora de 2xx segue erro com integration.error', () => {
    const result = integrationOutcome({ context: {}, status: 422, body: '{"message":"duplicado"}', responseFields: fields });
    expect(result.port).toBe('failure');
    expect(result.context).toMatchObject({ integration: { error: { status: 422, message: 'A integração respondeu HTTP 422.' } } });
  });

  it('erro de rede ou timeout segue erro sem status', () => {
    const result = integrationOutcome({ context: {}, status: null, body: null, error: 'A integração não respondeu em 15 segundos.', responseFields: [] });
    expect(result.port).toBe('failure');
    expect(result.context).toMatchObject({ integration: { error: { status: null, message: 'A integração não respondeu em 15 segundos.' } } });
  });

  it('com campos mapeados, resposta que não é JSON vira erro', () => {
    expect(integrationOutcome({ context: {}, status: 200, body: 'ok', responseFields: fields }).port).toBe('failure');
    expect(integrationOutcome({ context: {}, status: 200, body: 'ok', responseFields: [] }).port).toBe('success');
  });
});

describe('parseResponseFields', () => {
  it('descarta itens inválidos e limita a 20', () => {
    expect(parseResponseFields([{ path: 'body.a', variable: 'a' }, { path: '', variable: 'b' }, null])).toEqual([{ path: 'body.a', variable: 'a' }]);
    expect(parseResponseFields(Array.from({ length: 25 }, (_, i) => ({ path: `body.${i}`, variable: `v${i}` })))).toHaveLength(20);
  });
});

describe('selectPortEdge', () => {
  const edges = [
    { id: 'legacy', source: 'api', target: 'ok', isDefault: false, priority: 0 },
    { id: 'fail', source: 'api', target: 'bad', port: 'failure', isDefault: false, priority: 0 }
  ] as AutomationEdge[];
  it('conexão sem porta atende sucesso', () => {
    expect(selectPortEdge(edges, 'api', 'success')?.id).toBe('legacy');
    expect(selectPortEdge(edges, 'api', 'failure')?.id).toBe('fail');
    expect(selectPortEdge(edges, 'other', 'success')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run apps/runtime/src/automation/integration.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 3: Mover `setContextPath` e criar `selectPortEdge` em `routing.ts`**

Em `automation-engine.service.ts`, apagar a constante `setContextPath` (bloco `const setContextPath = (context: EngineContext, path: string, value: unknown): EngineContext => { … };`) e importar `setContextPath` e `selectPortEdge` de `./routing.js`. Em `routing.ts`, acrescentar `edgePort, type EdgePort` ao import de `@nexo/contracts` e adicionar:

```ts
export function setContextPath<T extends Record<string, unknown>>(context: T, path: string, value: unknown): T {
  const next = structuredClone(context) as Record<string, unknown>;
  const parts = path.split('.');
  let current = next;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) current[part] = value;
    else {
      const child = current[part];
      current[part] = child && typeof child === 'object' && !Array.isArray(child) ? child : {};
      current = current[part] as Record<string, unknown>;
    }
  });
  return next as T;
}

export function selectPortEdge(edges: AutomationEdge[], nodeId: string, port: EdgePort): AutomationEdge | undefined {
  return edges.find(edge => edge.source === nodeId && edgePort(edge) === port);
}
```

- [ ] **Step 4: `apps/runtime/src/automation/integration.ts`**

```ts
import { getPathValue, setContextPath } from './routing.js';

export type ResponseField = { path: string; variable: string };
type Context = Record<string, unknown>;
export type IntegrationResult = { port: 'success' | 'failure'; context: Context; output: Record<string, unknown> };

export function parseResponseFields(value: unknown): ResponseField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const field = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return typeof field.path === 'string' && field.path.trim() && typeof field.variable === 'string' && field.variable.trim()
      ? [{ path: field.path.trim(), variable: field.variable.trim() }]
      : [];
  }).slice(0, 20);
}

// Decides the exit of an Integração block from the HTTP result and writes the response into the context.
export function integrationOutcome(input: { context: Context; status: number | null; body: string | null; headers?: Record<string, string>; error?: string; responseVariable?: string; responseFields: ResponseField[] }): IntegrationResult {
  const failure = (context: Context, message: string): IntegrationResult => ({
    port: 'failure',
    context: setContextPath(context, 'integration.error', { status: input.status, message }),
    output: { status: input.status, error: message }
  });
  if (input.error) return failure(input.context, input.error);
  let parsed: unknown = input.body;
  try { parsed = input.body ? JSON.parse(input.body) : null; } catch { /* textual response */ }
  const context: Context = { ...input.context, webhook: { status: input.status, body: parsed } };
  if (input.status === null || input.status < 200 || input.status > 299) return failure(context, `A integração respondeu HTTP ${input.status}.`);
  if (input.responseFields.length && (parsed === null || typeof parsed !== 'object')) return failure(context, 'A resposta da integração não é JSON.');
  let next = input.responseVariable ? setContextPath(context, input.responseVariable, parsed) : context;
  const source = { status: input.status, body: parsed, headers: input.headers ?? {} };
  for (const field of input.responseFields) next = setContextPath(next, field.variable, getPathValue(source, field.path));
  return { port: 'success', context: next, output: { status: input.status, body: input.body } };
}
```

- [ ] **Step 5: Engine — laço aceita `{ next }`**

Em `executeLocked`, no laço `while (currentNodeId)`:
- declarar antes do `try`: `let routedNodeId: string | undefined = nextNodeId;`
- trocar `if (result === 'waiting' || result === 'terminal') return;` por:
```ts
        if (result === 'waiting' || result === 'terminal') return;
        if (typeof result === 'object') routedNodeId = result.next;
```
- trocar `currentNodeId = nextNodeId;` por `currentNodeId = routedNodeId;`.
- Assinatura de `runNode`: `Promise<'continue' | 'waiting' | 'terminal' | { next: string }>`.

- [ ] **Step 6: Engine — caso `webhook`**

Substituir o `case 'webhook': { … }` inteiro por:

```ts
      case 'webhook': {
        const url = stringConfig(node, 'url');
        if (!url.startsWith('https://')) throw new NodeExecutionError('WEBHOOK_HTTPS_REQUIRED', 'O webhook deve usar HTTPS.');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Math.min(input.definition.settings.timeoutSeconds * 1000, 15_000));
        let status: number | null = null;
        let body: string | null = null;
        let responseHeaders: Record<string, string> = {};
        let error: string | undefined;
        try {
          const method = typeof node.config.method === 'string' ? node.config.method.toUpperCase() : 'POST';
          const configuredHeaders = node.config.headers && typeof node.config.headers === 'object' && !Array.isArray(node.config.headers) ? node.config.headers as Record<string, unknown> : {};
          const headers = Object.fromEntries(Object.entries(configuredHeaders).filter((entry): entry is [string, string] => typeof entry[1] === 'string').map(([key, value]) => [key, renderTemplate(value, context)]));
          const configuredBody = typeof node.config.body === 'string' && node.config.body.trim() ? renderTemplate(node.config.body, context) : JSON.stringify({ executionId, conversationId, context });
          const response = await fetch(url, { method, headers: { 'content-type': 'application/json', 'idempotency-key': step.id, ...headers }, ...(!['GET', 'HEAD'].includes(method) ? { body: configuredBody } : {}), signal: controller.signal });
          status = response.status;
          body = (await response.text()).slice(0, 10_000);
          responseHeaders = Object.fromEntries(response.headers.entries());
        } catch (caught) {
          error = caught instanceof Error && caught.name === 'AbortError' ? 'A integração não respondeu em 15 segundos.' : 'Não foi possível conectar à integração.';
        } finally {
          clearTimeout(timeout);
        }
        const outcome = integrationOutcome({ context, status, body, headers: responseHeaders, error, responseVariable: typeof node.config.responseVariable === 'string' && node.config.responseVariable ? node.config.responseVariable : undefined, responseFields: parseResponseFields(node.config.responseFields) });
        const edge = selectPortEdge(input.definition.edges, node.id, outcome.port);
        if (!edge) {
          if (outcome.port === 'failure') throw new NodeExecutionError('WEBHOOK_FAILED', String(outcome.output.error));
          throw new NodeExecutionError('DEAD_END', `O nó ${node.id} não possui uma saída válida.`);
        }
        await this.completeStep(executionId, step.id, edge.target, outcome.context as EngineContext, asJson(outcome.output));
        return { next: edge.target };
      }
```
Importar `integrationOutcome` e `parseResponseFields` de `./integration.js`.

- [ ] **Step 7: Rodar** — `npx vitest run apps/runtime && npx tsc --noEmit -p apps/runtime` → PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/runtime/src/automation/integration.ts apps/runtime/src/automation/integration.test.ts apps/runtime/src/automation/routing.ts apps/runtime/src/automation/automation-engine.service.ts
git commit -m "feat(runtime): integration success/failure ports and mapped response fields"
```

---

### Task 4: Banco e API — chave da OpenAI cifrada e tabela de mídia

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261015120000_ai_key_and_message_media/migration.sql`
- Modify: `apps/api/src/modules/workspaces/routes.ts`
- Modify: `apps/api/src/modules/workspaces/settings.ts`
- Modify: `apps/api/src/modules/workspaces/settings.test.ts`

**Interfaces:**
- Consumes: `SetAiKeyInput` (Task 1); `encryptWebhookSecret` de `apps/api/src/modules/webhooks/generic.ts` (mesmo formato `v1` que o `FieldCipher` do runtime decifra).
- Produces: colunas `Workspace.openaiApiKeyEncrypted`, `Workspace.openaiApiKeyLast4`; modelo `MessageMedia` (`id, workspaceId, messageId @unique, contentType, fileName?, size, data Bytes?, createdAt`, relação `Message.media`); rotas `GET|PUT|DELETE /v1/workspace/ai-key` → `{ configured: boolean; last4: string | null }`; `keyLast4(key: string): string`.

- [ ] **Step 1: Teste** — acrescentar em `settings.test.ts` (dentro do `describe` existente ou num novo):

```ts
import { keyLast4 } from './settings.js';
describe('keyLast4', () => {
  it('mostra só os 4 últimos caracteres', () => {
    expect(keyLast4('sk-proj-abcdefghijklmnop1234')).toBe('1234');
  });
});
```
(mova o import para o topo junto dos demais.)

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run apps/api/src/modules/workspaces/settings.test.ts` → FAIL (`keyLast4` não exportado).

- [ ] **Step 3: `settings.ts`** — adicionar:
```ts
export function keyLast4(key:string){return key.trim().slice(-4)}
```

- [ ] **Step 4: Schema Prisma**

No `model Workspace`, após `settings`:
```prisma
  openaiApiKeyEncrypted String?
  openaiApiKeyLast4     String?
```
No `model Message`, antes de `@@unique`: `  media          MessageMedia?`
Novo modelo:
```prisma
model MessageMedia {
  id          String   @id @default(cuid())
  workspaceId String
  messageId   String   @unique
  contentType String
  fileName    String?
  size        Int
  data        Bytes?
  createdAt   DateTime @default(now())
  message     Message  @relation(fields: [messageId], references: [id], onDelete: Cascade)
  @@index([createdAt])
}
```

- [ ] **Step 5: Migração** — `apps/api/prisma/migrations/20261015120000_ai_key_and_message_media/migration.sql`:
```sql
ALTER TABLE "Workspace" ADD COLUMN "openaiApiKeyEncrypted" TEXT,
ADD COLUMN "openaiApiKeyLast4" TEXT;

CREATE TABLE "MessageMedia" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileName" TEXT,
    "size" INTEGER NOT NULL,
    "data" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageMedia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageMedia_messageId_key" ON "MessageMedia"("messageId");
CREATE INDEX "MessageMedia_createdAt_idx" ON "MessageMedia"("createdAt");
ALTER TABLE "MessageMedia" ADD CONSTRAINT "MessageMedia_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```
Run: `npx prisma validate --schema apps/api/prisma/schema.prisma && npm run db:generate -w apps/api` (não rode `migrate`).

- [ ] **Step 6: Rotas em `workspaces/routes.ts`**

- Nas rotas `GET /v1/workspace` e `PATCH /v1/workspace`, acrescentar `omit:{openaiApiKeyEncrypted:true}` às chamadas `findUniqueOrThrow`/`update` do Prisma, para a cifra nunca sair pela API.
- Importar `SetAiKeyInput` de `@nexo/contracts`, `encryptWebhookSecret` de `../webhooks/generic.js` e `keyLast4` de `./settings.js`.
- Adicionar (seguindo o estilo e o helper `audit` já usados no arquivo):
```ts
  const aiKeyView=(workspace:{openaiApiKeyEncrypted:string|null;openaiApiKeyLast4:string|null})=>({configured:Boolean(workspace.openaiApiKeyEncrypted),last4:workspace.openaiApiKeyLast4});
  app.get('/v1/workspace/ai-key',{preHandler:[app.authenticate]},async request=>aiKeyView(await app.prisma.workspace.findUniqueOrThrow({where:{id:request.auth.workspaceId},select:{openaiApiKeyEncrypted:true,openaiApiKeyLast4:true}})));
  app.put('/v1/workspace/ai-key',{preHandler:[app.requirePermission('workspace.manage')]},async request=>{const {apiKey}=SetAiKeyInput.parse(request.body);const last4=keyLast4(apiKey);const workspace=await app.prisma.workspace.update({where:{id:request.auth.workspaceId},data:{openaiApiKeyEncrypted:encryptWebhookSecret(apiKey),openaiApiKeyLast4:last4},select:{openaiApiKeyEncrypted:true,openaiApiKeyLast4:true}});await audit(app.prisma,{workspaceId:request.auth.workspaceId,actorId:request.auth.userId,action:'workspace.ai_key.updated',targetType:'Workspace',targetId:request.auth.workspaceId,changes:{last4},ip:request.ip});return aiKeyView(workspace)});
  app.delete('/v1/workspace/ai-key',{preHandler:[app.requirePermission('workspace.manage')]},async request=>{const workspace=await app.prisma.workspace.update({where:{id:request.auth.workspaceId},data:{openaiApiKeyEncrypted:null,openaiApiKeyLast4:null},select:{openaiApiKeyEncrypted:true,openaiApiKeyLast4:true}});await audit(app.prisma,{workspaceId:request.auth.workspaceId,actorId:request.auth.userId,action:'workspace.ai_key.removed',targetType:'Workspace',targetId:request.auth.workspaceId,changes:{},ip:request.ip});return aiKeyView(workspace)});
```
(ajuste a assinatura de `audit` se o helper do arquivo diferir; a chave nunca entra em `changes`.)

- [ ] **Step 7: Rodar** — `npx vitest run apps/api && npx tsc --noEmit -p apps/api && npx tsc --noEmit -p apps/runtime` → PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20261015120000_ai_key_and_message_media apps/api/src/modules/workspaces/routes.ts apps/api/src/modules/workspaces/settings.ts apps/api/src/modules/workspaces/settings.test.ts
git commit -m "feat(api): encrypted workspace OpenAI key endpoints and message media table"
```

---

### Task 5: Runtime — guardar mídia recebida e variáveis novas no contexto

**Files:**
- Modify: `apps/runtime/src/whatsapp/message-content.ts`, `apps/runtime/src/whatsapp/message-content.test.ts`
- Modify: `apps/runtime/src/whatsapp/session-manager.service.ts`
- Modify: `apps/runtime/src/automation/live-context.ts`, `apps/runtime/src/automation/live-context.test.ts`
- Modify: `apps/runtime/src/runtime-workers.service.ts`

**Interfaces:**
- Consumes: modelo `MessageMedia` (Task 4).
- Produces: `MEDIA_MAX_BYTES = 10 * 1024 * 1024`, `MEDIA_RETENTION_MS = 30 * 86_400_000`, `type StorableMedia = { contentType: string; fileName: string | null; size: number; download: boolean }`, `storableMedia(raw: proto.IMessage | null | undefined): StorableMedia | null` (message-content.ts); `firstName(name: string | null): string` (live-context.ts); `contact.firstName` também no contexto ao vivo.

- [ ] **Step 1: Testes**

Acrescentar em `message-content.test.ts` (importando `storableMedia`, `MEDIA_MAX_BYTES`):
```ts
  it('marca imagem e PDF até 10 MB para baixar, maiores só como metadado', () => {
    expect(storableMedia({ imageMessage: { mimetype: 'image/jpeg', fileLength: 2048 } })).toEqual({ contentType: 'image/jpeg', fileName: null, size: 2048, download: true });
    expect(storableMedia({ documentMessage: { mimetype: 'application/pdf', fileName: 'comprovante.pdf', fileLength: MEDIA_MAX_BYTES + 1 } })).toEqual({ contentType: 'application/pdf', fileName: 'comprovante.pdf', size: MEDIA_MAX_BYTES + 1, download: false });
    expect(storableMedia({ ephemeralMessage: { message: { imageMessage: { mimetype: 'image/png', fileLength: 10 } } } })?.download).toBe(true);
  });

  it('ignora documentos que não são PDF/imagem e mensagens de texto', () => {
    expect(storableMedia({ documentMessage: { mimetype: 'application/zip', fileLength: 10 } })).toBeNull();
    expect(storableMedia({ conversation: 'oi' })).toBeNull();
  });
```
Acrescentar em `live-context.test.ts` (importando `firstName`):
```ts
describe('firstName', () => {
  it('pega a primeira palavra do nome', () => {
    expect(firstName('  Ana Paula Souza ')).toBe('Ana');
    expect(firstName(null)).toBe('');
  });
  it('vai para o contexto ao vivo', () => {
    expect(liveConditionContext(snapshot()).contact.firstName).toBe('Ana');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run apps/runtime/src/whatsapp/message-content.test.ts apps/runtime/src/automation/live-context.test.ts` → FAIL.

- [ ] **Step 3: `message-content.ts`**

```ts
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
export const MEDIA_RETENTION_MS = 30 * 86_400_000;
export type StorableMedia = { contentType: string; fileName: string | null; size: number; download: boolean };

// Images and PDFs are kept so the AI block can read receipts; anything larger than the cap keeps only metadata.
export function storableMedia(raw: proto.IMessage | null | undefined): StorableMedia | null {
  const message = unwrap(raw);
  const image = message?.imageMessage;
  const document = message?.documentMessage;
  const media = image ?? (document && (document.mimetype === 'application/pdf' || document.mimetype?.startsWith('image/')) ? document : null);
  if (!media) return null;
  const size = Number(media.fileLength ?? 0);
  return { contentType: media.mimetype ?? (image ? 'image/jpeg' : 'application/pdf'), fileName: document?.fileName ?? null, size, download: size > 0 && size <= MEDIA_MAX_BYTES };
}
```

- [ ] **Step 4: `live-context.ts`** — adicionar `export function firstName(name: string | null): string { return name?.trim().split(/\s+/)[0] ?? ''; }` e, em `liveConditionContext`, `contact: { ...snapshot.contact, firstName: firstName(snapshot.contact.name), tagIds: … }`.

- [ ] **Step 5: `session-manager.service.ts`** — no laço de mensagens recebidas:
- importar `downloadMediaMessage` de `@whiskeysockets/baileys` e `MEDIA_MAX_BYTES`, `storableMedia` de `./message-content.js`;
- logo após `const reply = menuReply(incoming.message);`:
```ts
      const media = storableMedia(incoming.message);
      let mediaData: Buffer | null = null;
      if (media?.download) {
        try {
          const downloaded = await downloadMediaMessage(incoming, 'buffer', {});
          mediaData = downloaded.length <= MEDIA_MAX_BYTES ? downloaded : null;
        } catch (error) {
          this.logger.warn({ channelId, externalId, err: error }, 'failed to download inbound media');
        }
      }
```
- dentro da transação, logo após `const created = await tx.message.create(…)`:
```ts
          if (media) await tx.messageMedia.create({ data: { workspaceId: channel.workspaceId, messageId: created.id, contentType: media.contentType, fileName: media.fileName, size: media.size, data: mediaData } });
```

- [ ] **Step 6: `runtime-workers.service.ts`**

1. Contexto inicial em `startTriggeredExecution`: no objeto `contact`, adicionar `firstName: firstName(conversation.contact.name),` (import de `./automation/live-context.js`); no objeto `context`, adicionar `channel: { id: conversation.channel.id, phone: conversation.channel.phoneNumber },` e `last_message: input.messageId ? (await this.prisma.message.findUnique({ where: { id: input.messageId }, select: { body: true } }))?.body ?? '' : '',`.
2. Limpeza de mídia: ao lado de `this.outboxTimer = setInterval(…)`, criar `this.mediaTimer = setInterval(() => { void this.purgeExpiredMedia(); }, 6 * 3_600_000);` com o campo `private mediaTimer?: NodeJS.Timeout;`, limpar junto do `outboxTimer` no encerramento, e o método:
```ts
  private async purgeExpiredMedia() {
    try {
      await this.prisma.messageMedia.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - MEDIA_RETENTION_MS) } } });
    } catch (error) {
      this.logger.warn({ err: error }, 'failed to purge expired message media');
    }
  }
```
(se a classe não tiver `this.logger`, use o logger já usado no arquivo; import de `MEDIA_RETENTION_MS` de `./whatsapp/message-content.js`).

- [ ] **Step 7: Rodar** — `npx vitest run apps/runtime && npx tsc --noEmit -p apps/runtime` → PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/runtime/src/whatsapp/message-content.ts apps/runtime/src/whatsapp/message-content.test.ts apps/runtime/src/whatsapp/session-manager.service.ts apps/runtime/src/automation/live-context.ts apps/runtime/src/automation/live-context.test.ts apps/runtime/src/runtime-workers.service.ts
git commit -m "feat(runtime): store inbound images/PDFs and expose first name, channel phone and last message"
```

---

### Task 6: Runtime — Bloco de IA direto

**Files:**
- Create: `apps/runtime/src/automation/ai-call.ts`
- Create: `apps/runtime/src/automation/ai-call.test.ts`
- Modify: `apps/runtime/src/automation/automation-engine.service.ts`

**Interfaces:**
- Consumes: `selectPortEdge`, `setContextPath` (Task 3), `runNode` → `{ next }` (Task 3), `Message.media` (Task 4/5), `FieldCipher` + `loadConfig` (existentes).
- Produces: `type AiMedia`, `type ChatMessage`, `buildAiMessages(input): ChatMessage[]`, `type AiCallResult`, `callOpenAi(input): Promise<AiCallResult>`.

- [ ] **Step 1: Testes** — `apps/runtime/src/automation/ai-call.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildAiMessages, callOpenAi } from './ai-call.js';

const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('buildAiMessages', () => {
  it('texto puro: sistema, histórico e usuário', () => {
    expect(buildAiMessages({ systemPrompt: 'Sistema', userMessage: 'oi', history: [{ role: 'assistant', content: 'olá' }] })).toEqual([
      { role: 'system', content: 'Sistema' }, { role: 'assistant', content: 'olá' }, { role: 'user', content: 'oi' }
    ]);
  });

  it('anexa imagem como image_url e PDF como file', () => {
    const image = buildAiMessages({ systemPrompt: 's', userMessage: 'veja', history: [], media: { contentType: 'image/png', data: Buffer.from('x'), fileName: null } });
    expect(image[1]).toEqual({ role: 'user', content: [{ type: 'text', text: 'veja' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,eA==' } }] });
    const pdf = buildAiMessages({ systemPrompt: 's', userMessage: '', history: [], media: { contentType: 'application/pdf', data: Buffer.from('x'), fileName: 'c.pdf' } });
    expect(pdf[1]).toEqual({ role: 'user', content: [{ type: 'text', text: '(sem texto)' }, { type: 'file', file: { filename: 'c.pdf', file_data: 'data:application/pdf;base64,eA==' } }] });
  });
});

describe('callOpenAi', () => {
  const base = { apiKey: 'sk-test', model: 'gpt-5.4-mini', messages: [{ role: 'user' as const, content: 'oi' }] };
  it('sucesso devolve texto e tokens', async () => {
    expect(await callOpenAi({ ...base, fetchImpl: reply(200, { choices: [{ message: { content: ' #R$15,00 ' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) })).toEqual({ ok: true, text: '#R$15,00', tokens: 15 });
  });
  it('traduz erros em motivos legíveis', async () => {
    expect(await callOpenAi({ ...base, fetchImpl: reply(401, {}) })).toEqual({ ok: false, reason: 'Chave da OpenAI inválida.' });
    expect(await callOpenAi({ ...base, fetchImpl: reply(429, {}) })).toEqual({ ok: false, reason: 'Limite ou créditos da OpenAI esgotados.' });
    expect(await callOpenAi({ ...base, fetchImpl: reply(200, { choices: [{ message: { content: '' } }] }) })).toEqual({ ok: false, reason: 'A IA não retornou texto.' });
    expect(await callOpenAi({ ...base, fetchImpl: (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch })).toEqual({ ok: false, reason: 'Não foi possível conectar à OpenAI.' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run apps/runtime/src/automation/ai-call.test.ts` → FAIL.

- [ ] **Step 3: `apps/runtime/src/automation/ai-call.ts`**

```ts
export type AiMedia = { contentType: string; data: Buffer; fileName: string | null };
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string | Array<Record<string, unknown>> };
export type AiCallResult = { ok: true; text: string; tokens: number } | { ok: false; reason: string };

export function buildAiMessages(input: { systemPrompt: string; userMessage: string; history: Array<{ role: 'user' | 'assistant'; content: string }>; media?: AiMedia | null }): ChatMessage[] {
  let user: ChatMessage['content'] = input.userMessage;
  if (input.media) {
    const dataUrl = `data:${input.media.contentType};base64,${input.media.data.toString('base64')}`;
    user = [
      { type: 'text', text: input.userMessage || '(sem texto)' },
      input.media.contentType === 'application/pdf'
        ? { type: 'file', file: { filename: input.media.fileName ?? 'documento.pdf', file_data: dataUrl } }
        : { type: 'image_url', image_url: { url: dataUrl } }
    ];
  }
  return [{ role: 'system', content: input.systemPrompt }, ...input.history, { role: 'user', content: user }];
}

export async function callOpenAi(input: { apiKey: string; model: string; messages: ChatMessage[]; baseUrl?: string; timeoutMs?: number; fetchImpl?: typeof fetch }): Promise<AiCallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 60_000);
  try {
    const response = await (input.fetchImpl ?? fetch)(`${(input.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: input.model, messages: input.messages }),
      signal: controller.signal
    });
    if (!response.ok) return { ok: false, reason: response.status === 401 ? 'Chave da OpenAI inválida.' : response.status === 429 ? 'Limite ou créditos da OpenAI esgotados.' : `A OpenAI respondeu HTTP ${response.status}.` };
    const body = await response.json() as { choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const message = body.choices?.[0]?.message;
    if (message?.refusal) return { ok: false, reason: `A IA recusou: ${message.refusal}`.slice(0, 500) };
    const text = message?.content?.trim();
    if (!text) return { ok: false, reason: 'A IA não retornou texto.' };
    return { ok: true, text: text.slice(0, 8000), tokens: (body.usage?.prompt_tokens ?? 0) + (body.usage?.completion_tokens ?? 0) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error && error.name === 'AbortError' ? 'A IA não respondeu em 60 segundos.' : 'Não foi possível conectar à OpenAI.' };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Engine — chave e caso `ai`**

Imports: `buildAiMessages`, `callOpenAi` de `./ai-call.js`; `FieldCipher` de `../crypto/field-cipher.js`; `loadConfig` de `../config.js`. Campo da classe: `private readonly cipher = new FieldCipher(loadConfig().encryptionKey);`. Método:
```ts
  private async openAiKey(workspaceId: string): Promise<string | null> {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { openaiApiKeyEncrypted: true } });
    if (workspace?.openaiApiKeyEncrypted) return this.cipher.decrypt(workspace.openaiApiKeyEncrypted);
    return process.env.OPENAI_API_KEY || null;
  }
```
Novo `case 'ai'` em `runNode` (antes de `case 'agent'`):
```ts
      case 'ai': {
        const config = node.config;
        const latest = await this.prisma.message.findFirst({ where: { workspaceId, conversationId, direction: 'INBOUND' }, orderBy: { createdAt: 'desc' }, include: { media: true } });
        let aiContext: EngineContext = { ...context, last_message: latest?.body ?? '' };
        const responseVariable = typeof config.responseVariable === 'string' && config.responseVariable ? config.responseVariable : 'resposta.gpt';
        const failReasonVariable = typeof config.failReasonVariable === 'string' && config.failReasonVariable ? config.failReasonVariable : 'ai.fail.reason';
        const finish = async (port: 'success' | 'failure', nextContext: EngineContext, output: Record<string, unknown>) => {
          const edge = selectPortEdge(input.definition.edges, node.id, port);
          if (!edge) {
            if (port === 'failure') throw new NodeExecutionError('AI_FAILED', String(output.reason));
            throw new NodeExecutionError('DEAD_END', `O nó ${node.id} não possui uma saída válida.`);
          }
          await this.completeStep(executionId, step.id, edge.target, nextContext, asJson(output));
          return { next: edge.target };
        };
        const fail = (reason: string) => finish('failure', setContextPath(aiContext, failReasonVariable, reason), { reason });
        const apiKey = await this.openAiKey(workspaceId);
        if (!apiKey) return fail('Chave da OpenAI não configurada.');
        const readsMedia = Boolean(latest) && ((config.understandImage === true && latest!.type === 'IMAGE') || (config.understandPdf === true && latest!.type === 'DOCUMENT'));
        if (readsMedia && !latest!.media?.data) return fail('Arquivo grande demais ou indisponível para a IA.');
        const media = readsMedia && latest!.media?.data ? { contentType: latest!.media.contentType, data: Buffer.from(latest!.media.data), fileName: latest!.media.fileName } : null;
        const previousTurns = Math.min(20, Math.max(1, Number(config.contextInteractions) || 1)) - 1;
        const previous = previousTurns > 0 && latest ? await this.prisma.message.findMany({ where: { workspaceId, conversationId, createdAt: { lt: latest.createdAt }, body: { not: null } }, orderBy: { createdAt: 'desc' }, take: previousTurns, select: { direction: true, body: true } }) : [];
        const history = previous.reverse().map(item => ({ role: item.direction === 'INBOUND' ? 'user' as const : 'assistant' as const, content: item.body ?? '' }));
        const userMessage = renderTemplate(typeof config.userMessage === 'string' ? config.userMessage : '{{last_message}}', aiContext);
        const result = await callOpenAi({ apiKey, model: typeof config.model === 'string' && config.model ? config.model : 'gpt-5.4-mini', baseUrl: process.env.OPENAI_BASE_URL, messages: buildAiMessages({ systemPrompt: stringConfig(node, 'systemPrompt'), userMessage, history, media }) });
        if (!result.ok) return fail(result.reason);
        await this.prisma.usageRecord.create({ data: { workspaceId, kind: 'ai_tokens', quantity: result.tokens, unit: 'token', costCents: 0, provider: 'openai', referenceId: executionId } });
        aiContext = setContextPath(aiContext, responseVariable, result.text);
        if (config.autoSendResponse === true) {
          await this.prisma.$transaction(async tx => {
            const message = await tx.message.create({ data: { workspaceId, conversationId, direction: 'OUTBOUND', type: 'TEXT', status: 'PENDING', body: result.text.slice(0, 4096), authorType: 'automation', authorId: executionId } });
            await tx.outboxEvent.create({ data: { workspaceId, aggregate: 'Message', aggregateId: message.id, type: 'message.send.requested', payload: { messageId: message.id } } });
          });
        }
        return finish('success', aiContext, { tokens: result.tokens, chars: result.text.length });
      }
```

- [ ] **Step 5: Rodar** — `npx vitest run apps/runtime && npx tsc --noEmit -p apps/runtime` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/runtime/src/automation/ai-call.ts apps/runtime/src/automation/ai-call.test.ts apps/runtime/src/automation/automation-engine.service.ts
git commit -m "feat(runtime): direct AI block with image/PDF input, response variable and success/failure ports"
```

---

### Task 7: Editor — saídas sucesso/erro e campos da resposta da Integração

**Files:**
- Modify: `apps/web/src/shared/types/api.ts`
- Modify: `apps/web/src/features/playbooks/PlaybookEditorPage.tsx`
- Modify: `apps/web/src/features/playbooks/flow-builder.css`

**Interfaces:**
- Consumes: nada novo do web (portas declaradas localmente, sem importar contracts).
- Produces: `NODE_PORTS` local no editor (`{ webhook: ['success','failure'], ai: ['success','failure'] }`), `FlowEdgeData.port`.

- [ ] **Step 1: Tipos** — em `api.ts`: `AutomationNodeKind` ganha `|'ai'`; `AutomationEdge` ganha `port?:'success'|'failure'|'reply'|'timeout'`.

- [ ] **Step 2: Editor — portas**

Em `PlaybookEditorPage.tsx`:
1. Perto das constantes do Menu:
```ts
// Mirrors packages/contracts/src/ports.ts (NODE_PORTS).
const NODE_PORTS:Partial<Record<AutomationNodeKind,Array<'success'|'failure'>>>={webhook:['success','failure'],ai:['success','failure']};
const PORT_LABELS={success:'sucesso',failure:'erro'} as const;
```
2. `type FlowEdgeData` ganha `port?:'success'|'failure'`.
3. `sourceHandleFor`: primeira linha `if(kind&&NODE_PORTS[kind])return edge.port??'success';`.
4. `toFlow`: acrescentar `port:edge.port` ao `data` da aresta. `toDefinition`: acrescentar `...(edge.data?.port?{port:edge.data.port}:{})` ao objeto da aresta.
5. `AutomationNodeCard`: para nós com portas, esconder a alça de saída genérica (condição `!terminal&&data.kind!=='buttons'&&!NODE_PORTS[data.kind]`) e renderizar antes do fechamento do card:
```tsx
  {NODE_PORTS[data.kind]&&<div className="node-ports">{NODE_PORTS[data.kind]!.map(port=><div key={port} className={`node-port ${port}`}><span>{PORT_LABELS[port]}</span><Handle id={port} type="source" position={Position.Right}/></div>)}</div>}
```
6. `connect`: novo ramo antes do ramo da condição:
```ts
    else if(source&&NODE_PORTS[source.data.kind]&&(handle==='success'||handle==='failure')){data={port:handle,isDefault:false,priority:handle==='success'?0:1};label=PORT_LABELS[handle]}
```
e a regra de substituição passa a valer também para nós com portas: `const replaces=(edge:FlowEdge)=>(source?.data.kind==='buttons'||Boolean(source&&NODE_PORTS[source.data.kind]))&&edge.source===connection.source&&edge.sourceHandle===connection.sourceHandle;`.
7. `connectionRule(kind)`: para `NODE_PORTS[kind]` devolver `'Saídas: sucesso (obrigatória) e erro (opcional).'`.

- [ ] **Step 3: Editor — campos da resposta da Integração**

No formulário `kind==='webhook'` do `NodeInspector`, depois do campo "Salvar resposta na variável", adicionar a lista de campos (mesmo estilo de listas do arquivo):
```tsx
<div className="response-fields"><b>Campos da resposta</b>{(Array.isArray(config.responseFields)?config.responseFields as Array<{path:string;variable:string}>:[]).map((field,index,all)=><div key={index}><input aria-label={`Caminho do campo ${index+1}`} value={field.path} onChange={event=>onConfig('responseFields',all.map((item,i)=>i===index?{...item,path:event.target.value}:item))} placeholder="body.accepted"/><input aria-label={`Variável do campo ${index+1}`} value={field.variable} onChange={event=>onConfig('responseFields',all.map((item,i)=>i===index?{...item,variable:event.target.value}:item))} placeholder="kovil.receipt.accepted"/><button type="button" aria-label={`Remover campo ${index+1}`} onClick={()=>onConfig('responseFields',all.filter((_,i)=>i!==index))}><X size={14}/></button></div>)}<button type="button" className="add-button-option" disabled={Array.isArray(config.responseFields)&&config.responseFields.length>=20} onClick={()=>onConfig('responseFields',[...(Array.isArray(config.responseFields)?config.responseFields:[]),{path:'',variable:''}])}>+ Adicionar campo</button><p className="field-help">Caminho em status, body ou headers da resposta (ex.: body.accepted) e a variável que recebe o valor.</p></div>
```
Atualizar o texto de ajuda final do webhook para: "Respostas 2xx seguem por sucesso; erro HTTP, timeout de 15 s ou falha de rede seguem por erro.".

- [ ] **Step 4: CSS** (anexar a `flow-builder.css`):
```css
.node-ports{display:grid;gap:6px;padding:0 12px 12px}.node-port{position:relative;display:flex;justify-content:flex-end;font-size:10px;color:#dce8e2}.node-port .react-flow__handle{right:-14px}.node-port.success .react-flow__handle{background:#3fd47a}.node-port.failure .react-flow__handle{background:#ef7476}
.response-fields{display:grid;gap:6px;margin-bottom:13px}.response-fields>b{font-size:11px;color:#65736c}.response-fields>div{display:grid;grid-template-columns:1fr 1fr 32px;gap:6px}.response-fields>div button{border:0;border-radius:8px;background:transparent;color:#9aa5a0}.response-fields>div button:hover{background:#fde9e6;color:#b04c43}
```

- [ ] **Step 5: Rodar** — `npx tsc --noEmit -p apps/web && npx vitest run apps/web && npx vite build apps/web` → limpo, PASS, `✓ built`. (Os casos `'ai'` exigidos pelo TypeScript em `defaultConfig`/`nodePreviewLabel`/`catalog` são implementados na Task 8; se o tsc exigir aqui, adicione entradas mínimas `ai` e cite no relatório.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/shared/types/api.ts apps/web/src/features/playbooks/PlaybookEditorPage.tsx apps/web/src/features/playbooks/flow-builder.css
git commit -m "feat(web): success/failure exits on integration and AI nodes, integration response fields"
```

---

### Task 8: Editor e Configurações — Bloco de IA e chave da OpenAI

**Files:**
- Modify: `apps/web/src/features/playbooks/PlaybookEditorPage.tsx`
- Modify: `apps/web/src/features/settings/SettingsPage.tsx`
- Modify: `apps/web/src/features/settings/api/queries.ts`

**Interfaces:**
- Consumes: rotas `GET|PUT|DELETE /v1/workspace/ai-key` → `{ configured: boolean; last4: string | null }` (Task 4); `NODE_PORTS` (Task 7).
- Produces: `useWorkspaceAiKey()`, `useSaveAiKey()`, `useDeleteAiKey()`; aba `'ai'` nas Configurações.

- [ ] **Step 1: Queries** (`settings/api/queries.ts`, mesmo padrão dos hooks existentes):
```ts
export type WorkspaceAiKey={configured:boolean;last4:string|null};
export function useWorkspaceAiKey(){return useQuery({queryKey:['workspace','ai-key'],queryFn:()=>api<WorkspaceAiKey>('/v1/workspace/ai-key')})}
export function useSaveAiKey(){const client=useQueryClient();return useMutation({mutationFn:(apiKey:string)=>api<WorkspaceAiKey>('/v1/workspace/ai-key',{method:'PUT',body:JSON.stringify({apiKey})}),onSuccess:data=>client.setQueryData(['workspace','ai-key'],data)})}
export function useDeleteAiKey(){const client=useQueryClient();return useMutation({mutationFn:()=>api<WorkspaceAiKey>('/v1/workspace/ai-key',{method:'DELETE'}),onSuccess:data=>client.setQueryData(['workspace','ai-key'],data)})}
```

- [ ] **Step 2: Aba "Inteligência artificial"** em `SettingsPage.tsx`: `Tab` ganha `'ai'`; lista de abas ganha `['ai','Inteligência artificial']`; renderizar `{tab==='ai'&&<AiKeyPanel/>}` com:
```tsx
function AiKeyPanel(){const key=useWorkspaceAiKey();const save=useSaveAiKey();const remove=useDeleteAiKey();const [value,setValue]=useState('');const [error,setError]=useState('');
  async function submit(event:FormEvent){event.preventDefault();setError('');if(!value.trim().startsWith('sk-')){setError('A chave da OpenAI começa com sk-.');return}try{await save.mutateAsync(value.trim());setValue('')}catch{setError('Não foi possível salvar a chave.')}}
  return <section className="panel"><h2>Chave da OpenAI</h2><p>Usada pelos Blocos de IA dos fluxos. Fica guardada cifrada e nunca é exibida de novo.</p><p><b>{key.data?.configured?`Configurada (termina em ${key.data.last4})`:'Não configurada'}</b></p><form onSubmit={submit}><label>Nova chave<input type="password" autoComplete="off" value={value} onChange={event=>setValue(event.target.value)} placeholder="sk-..." aria-invalid={Boolean(error)}/></label>{error&&<small className="field-error">{error}</small>}<button className="primary" disabled={save.isPending||!value.trim()}>Salvar chave</button>{key.data?.configured&&<button type="button" onClick={()=>void remove.mutateAsync()} disabled={remove.isPending}>Remover chave</button>}</form></section>}
```
(importar `useState`/`FormEvent` e os hooks; seguir as classes já usadas nas outras abas.)

- [ ] **Step 3: Bloco no editor** (`PlaybookEditorPage.tsx`)

1. `catalog`: trocar a entrada `agent` por `{kind:'agent',icon:Sparkles,label:'Agente de IA',description:'Responde com um agente cadastrado',rule:'Exige um agente de IA selecionado e ativo.'}` e adicionar logo antes dela `{kind:'ai',icon:Bot,label:'Bloco de IA',description:'Chama a IA com prompt próprio',rule:'Exige prompt de sistema. Saída de sucesso grava a resposta na variável; saída de erro grava o motivo.'}` (importar `Bot` de lucide-react).
2. `defaultConfig`: `case 'ai':return {model:'gpt-5.4-mini',systemPrompt:'',userMessage:'{{last_message}}',understandImage:false,understandPdf:false,responseVariable:'resposta.gpt',failReasonVariable:'ai.fail.reason',autoSendResponse:false,contextInteractions:1};`
3. `nodePreviewLabel`: `ai:'Modelo:'`. `nodeSummary`: `if(kind==='ai')return \`${String(config.model||'gpt-5.4-mini')} · resposta em ${String(config.responseVariable||'resposta.gpt')}\`;`
4. Formulário no `NodeInspector` (`kind==='ai'`), recebendo via props o estado da chave (`aiKeyConfigured:boolean|undefined`, vindo de `useWorkspaceAiKey()` em `PlaybookEditorPage`):
```tsx
{kind==='ai'&&<>{aiKeyConfigured===false&&<p className="field-help">Configure a chave da OpenAI em Configurações → Inteligência artificial; sem ela o bloco segue pela saída de erro.</p>}<label>Modelo<input value={String(config.model??'gpt-5.4-mini')} onChange={event=>onConfig('model',event.target.value)} list="ai-models"/><datalist id="ai-models"><option value="gpt-5.4-mini"/><option value="gpt-5.4"/><option value="gpt-4.1-mini"/></datalist></label><label>Prompt do sistema<textarea rows={8} value={String(config.systemPrompt??'')} onChange={event=>onConfig('systemPrompt',event.target.value)} placeholder="Explique à IA o que analisar e o formato da resposta."/></label><label>Mensagem do usuário<input value={String(config.userMessage??'{{last_message}}')} onChange={event=>onConfig('userMessage',event.target.value)}/><small>Use {'{{last_message}}'} para a última mensagem do contato.</small></label><label className="check-field"><input type="checkbox" checked={config.understandImage===true} onChange={event=>onConfig('understandImage',event.target.checked)}/> Ler imagens recebidas</label><label className="check-field"><input type="checkbox" checked={config.understandPdf===true} onChange={event=>onConfig('understandPdf',event.target.checked)}/> Ler PDFs recebidos</label><label className="check-field"><input type="checkbox" checked={config.autoSendResponse===true} onChange={event=>onConfig('autoSendResponse',event.target.checked)}/> Enviar a resposta ao contato</label><label>Salvar resposta em<input value={String(config.responseVariable??'resposta.gpt')} onChange={event=>onConfig('responseVariable',event.target.value)}/></label><label>Salvar motivo da falha em<input value={String(config.failReasonVariable??'ai.fail.reason')} onChange={event=>onConfig('failReasonVariable',event.target.value)}/></label><label>Mensagens de contexto<input type="number" min="1" max="20" value={Number(config.contextInteractions??1)} onChange={event=>onConfig('contextInteractions',Math.min(20,Math.max(1,Number(event.target.value)||1)))}/></label></>}
```

- [ ] **Step 4: Rodar** — `npx tsc --noEmit -p apps/web && npx vitest run apps/web && npx vite build apps/web` → limpo, PASS, `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/playbooks/PlaybookEditorPage.tsx apps/web/src/features/settings/SettingsPage.tsx apps/web/src/features/settings/api/queries.ts
git commit -m "feat(web): direct AI block editor and workspace OpenAI key settings"
```
