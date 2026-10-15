# Condicional no padrão Leona — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o bloco Condicional por um editor com catálogo de condições (Sistema, Atendimento, Atendente, Campos) e fazer o runtime avaliar essas condições sobre o estado atual da conversa.

**Architecture:** Um avaliador puro de regras (`conditionMatches`, `getPathValue`, `systemContext`) passa a viver em `@nexo/contracts` e é usado pela API (validação/simulação) e pelo runtime. O runtime recarrega contato/conversa/sistema antes de avaliar um bloco Condicional. No web, um catálogo puro descreve cada tipo de condição e um modal `ConditionEditor` (mesmo padrão do `MenuEditor`) edita as regras.

**Tech Stack:** TypeScript, zod (contracts/api/runtime), Prisma, BullMQ, React 19 + @xyflow/react, lucide-react, vitest.

**Spec:** `docs/superpowers/specs/2026-10-15-flow-conditions.md`

## Global Constraints

- Textos de interface em pt-BR exatamente como na spec: "Editar Condicional", "Regra Lógica", "Regra corresponde a **todas** as condições (e)", "Regra corresponde a **qualquer** condição (ou)", "Condições", "Adicionar Condição", "Nenhuma condição adicionada. Clique em “Adicionar Condição” para começar.", "Adicionar condição ao fluxo", "Defina as condições e regra lógica para que o fluxo continue pela saída superior deste bloco:", "Selecionar condição", "Buscar condição...".
- Grupos e itens, nesta ordem: Sistema (Etiqueta, Dia da semana, Hora, Data, Janela de 24h), Atendimento (Aguardando, Atendendo, Resolvidos), Atendente (Atendente ativo do chat (lista)), Campos (Nome, Número, Email, Campo personalizado, Variável do fluxo).
- Status: Aguardando = `QUEUED`, Atendendo = `ASSIGNED`, Resolvidos = `RESOLVED`.
- Dias da semana: 0 = Domingo … 6 = Sábado.
- Máximo de 20 condições por bloco (já é o limite do schema).
- O web **não** importa `@nexo/contracts` (evita zod no bundle); tipos e constantes do web são declarados no próprio web.
- Nenhuma dependência nova. Ícones só de `lucide-react` (já instalado).
- Design system do modal: fundo claro, cor primária `var(--green)`, bordas `var(--line)`, mesmos padrões de `.menu-editor` em `apps/web/src/features/playbooks/flow-builder.css`.
- Testes: `npx vitest run <caminho>` a partir da raiz do repositório. Typecheck: `npx tsc --noEmit -p apps/<app>`.
- Toda mensagem de commit termina com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Avaliador compartilhado de condições

**Files:**
- Create: `packages/contracts/src/conditions.ts`
- Create: `packages/contracts/src/conditions.test.ts`
- Modify: `packages/contracts/src/index.ts` (linha do `AutomationEdgeConditionSchema`, ~linha 100)
- Modify: `apps/runtime/src/automation/routing.ts` (remover `getPathValue` e `conditionMatches` locais)
- Modify: `apps/api/src/modules/playbooks/compiler.ts` (remover `getPathValue` e `matches` locais, ~linhas 163-180)

**Interfaces:**
- Produces (exportados de `@nexo/contracts`):
  - `CONDITION_OPERATORS: readonly ['equals','not_equals','contains','not_contains','exists','not_exists','greater_than','less_than','in','not_in','between','not_between']`
  - `type ConditionOperator`
  - `getPathValue(source: Record<string, unknown>, path: string): unknown`
  - `conditionMatches(value: unknown, rule: { operator: ConditionOperator; value?: unknown }): boolean`
  - `type SystemContext = { weekday: number; time: string; date: string }`
  - `systemContext(now: Date, timeZone: string): SystemContext`
- `apps/runtime/src/automation/routing.ts` continua exportando `getPathValue` e `conditionMatches` (re-export), para não quebrar imports existentes.

- [ ] **Step 1: Escrever os testes do avaliador**

Criar `packages/contracts/src/conditions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { conditionMatches, getPathValue, systemContext } from './conditions.js';

describe('conditionMatches', () => {
  it('mantém os operadores existentes', () => {
    expect(conditionMatches('Ana', { operator: 'equals', value: 'Ana' })).toBe(true);
    expect(conditionMatches(['vip'], { operator: 'contains', value: 'vip' })).toBe(true);
    expect(conditionMatches(undefined, { operator: 'not_exists' })).toBe(true);
    expect(conditionMatches(80, { operator: 'greater_than', value: 50 })).toBe(true);
  });

  it('compara texto com texto em maior/menor (datas e horários ISO)', () => {
    expect(conditionMatches('2026-10-15', { operator: 'greater_than', value: '2026-10-01' })).toBe(true);
    expect(conditionMatches('2026-10-15', { operator: 'less_than', value: '2026-10-01' })).toBe(false);
    expect(conditionMatches('10', { operator: 'greater_than', value: 5 })).toBe(false);
  });

  it('in/not_in aceitam valor simples ou lista (interseção)', () => {
    expect(conditionMatches(3, { operator: 'in', value: [1, 2, 3] })).toBe(true);
    expect(conditionMatches(['t1', 't9'], { operator: 'in', value: ['t9'] })).toBe(true);
    expect(conditionMatches(['t1'], { operator: 'not_in', value: ['t9'] })).toBe(true);
    expect(conditionMatches(['t1', 't9'], { operator: 'not_in', value: ['t9'] })).toBe(false);
    expect(conditionMatches('x', { operator: 'in', value: 'x' })).toBe(false);
  });

  it('between é inclusivo e dá a volta quando início > fim', () => {
    expect(conditionMatches('08:00', { operator: 'between', value: ['08:00', '18:00'] })).toBe(true);
    expect(conditionMatches('18:01', { operator: 'between', value: ['08:00', '18:00'] })).toBe(false);
    expect(conditionMatches('23:30', { operator: 'between', value: ['22:00', '06:00'] })).toBe(true);
    expect(conditionMatches('05:59', { operator: 'between', value: ['22:00', '06:00'] })).toBe(true);
    expect(conditionMatches('12:00', { operator: 'between', value: ['22:00', '06:00'] })).toBe(false);
    expect(conditionMatches('12:00', { operator: 'not_between', value: ['22:00', '06:00'] })).toBe(true);
    expect(conditionMatches('12:00', { operator: 'between', value: ['08:00'] })).toBe(false);
  });
});

describe('getPathValue', () => {
  it('resolve caminhos aninhados', () => {
    expect(getPathValue({ contact: { customFields: { plano: 'pro' } } }, 'contact.customFields.plano')).toBe('pro');
    expect(getPathValue({ contact: null }, 'contact.name')).toBeUndefined();
  });
});

describe('systemContext', () => {
  it('usa o fuso do workspace', () => {
    // 02:30 UTC de 15/10/2026 = 23:30 de quarta, 14/10, em America/Bahia (UTC-3)
    expect(systemContext(new Date('2026-10-15T02:30:00Z'), 'America/Bahia')).toEqual({ weekday: 3, time: '23:30', date: '2026-10-14' });
  });

  it('cai em UTC quando o fuso é inválido', () => {
    expect(systemContext(new Date('2026-10-15T02:30:00Z'), 'Not/AZone')).toEqual({ weekday: 4, time: '02:30', date: '2026-10-15' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run packages/contracts/src/conditions.test.ts`
Expected: FAIL — `Failed to resolve import "./conditions.js"`.

- [ ] **Step 3: Implementar `packages/contracts/src/conditions.ts`**

```ts
// Pure rule evaluation shared by the API (validation/simulation) and the runtime.
export const CONDITION_OPERATORS = ['equals', 'not_equals', 'contains', 'not_contains', 'exists', 'not_exists', 'greater_than', 'less_than', 'in', 'not_in', 'between', 'not_between'] as const;
export type ConditionOperator = typeof CONDITION_OPERATORS[number];

export function getPathValue(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => current && typeof current === 'object'
    ? (current as Record<string, unknown>)[part]
    : undefined, source);
}

// Ordering only makes sense between two numbers or two strings (ISO dates, HH:MM).
const comparable = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string');

function within(value: unknown, range: unknown): boolean {
  if (!Array.isArray(range) || range.length !== 2) return false;
  const [from, to] = range as [unknown, unknown];
  if (!comparable(value, from) || !comparable(value, to)) return false;
  const v = value as string, a = from as string, b = to as string;
  // from > to wraps around, e.g. 22:00–06:00 crosses midnight.
  return a <= b ? v >= a && v <= b : v >= a || v <= b;
}

function intersects(value: unknown, expected: unknown): boolean {
  if (!Array.isArray(expected)) return false;
  return Array.isArray(value) ? value.some(item => expected.includes(item)) : expected.includes(value);
}

export function conditionMatches(value: unknown, rule: { operator: ConditionOperator; value?: unknown }): boolean {
  const expected = rule.value;
  switch (rule.operator) {
    case 'equals': return value === expected;
    case 'not_equals': return value !== expected;
    case 'contains': return Array.isArray(value) ? value.includes(expected) : typeof value === 'string' && value.includes(String(expected));
    case 'not_contains': return Array.isArray(value) ? !value.includes(expected) : typeof value !== 'string' || !value.includes(String(expected));
    case 'exists': return value !== undefined && value !== null;
    case 'not_exists': return value === undefined || value === null;
    case 'greater_than': return comparable(value, expected) && (value as string) > (expected as string);
    case 'less_than': return comparable(value, expected) && (value as string) < (expected as string);
    case 'in': return intersects(value, expected);
    case 'not_in': return Array.isArray(expected) && !intersects(value, expected);
    case 'between': return within(value, expected);
    case 'not_between': return Array.isArray(expected) && expected.length === 2 && !within(value, expected);
  }
}

export type SystemContext = { weekday: number; time: string; date: string };
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function systemContext(now: Date, timeZone: string): SystemContext {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  } catch {
    return systemContext(now, 'UTC');
  }
  const parts = Object.fromEntries(format.formatToParts(now).map(part => [part.type, part.value]));
  return { weekday: WEEKDAYS[parts.weekday ?? ''] ?? 0, time: `${parts.hour}:${parts.minute}`, date: `${parts.year}-${parts.month}-${parts.day}` };
}
```

- [ ] **Step 4: Rodar os testes do avaliador**

Run: `npx vitest run packages/contracts/src/conditions.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Usar o enum e validar valores no schema**

Em `packages/contracts/src/index.ts`, no topo (logo após o `import { z } ...`), adicionar:

```ts
import { CONDITION_OPERATORS } from './conditions.js';
export * from './conditions.js';
```

Substituir a linha inteira do `AutomationEdgeConditionSchema` por:

```ts
export const AutomationEdgeConditionSchema=z.object({field:z.string().trim().min(1).max(120),operator:z.enum(CONDITION_OPERATORS),value:z.unknown().optional()}).superRefine((rule,ctx)=>{
  if((rule.operator==='in'||rule.operator==='not_in')&&(!Array.isArray(rule.value)||rule.value.length===0))ctx.addIssue({code:z.ZodIssueCode.custom,path:['value'],message:'Selecione ao menos um valor.'});
  if((rule.operator==='between'||rule.operator==='not_between')&&(!Array.isArray(rule.value)||rule.value.length!==2))ctx.addIssue({code:z.ZodIssueCode.custom,path:['value'],message:'Informe o início e o fim do intervalo.'});
});
```

Adicionar ao fim de `conditions.test.ts`:

```ts
import { AutomationEdgeConditionSchema } from './index.js';

describe('AutomationEdgeConditionSchema', () => {
  it('exige lista em in/not_in e par em between', () => {
    expect(AutomationEdgeConditionSchema.safeParse({ field: 'system.weekday', operator: 'in', value: [] }).success).toBe(false);
    expect(AutomationEdgeConditionSchema.safeParse({ field: 'system.time', operator: 'between', value: ['08:00'] }).success).toBe(false);
    expect(AutomationEdgeConditionSchema.safeParse({ field: 'system.time', operator: 'between', value: ['08:00', '18:00'] }).success).toBe(true);
  });
});
```

(mova o `import` para o topo do arquivo, junto dos demais.)

- [ ] **Step 6: Trocar as cópias locais no runtime**

Em `apps/runtime/src/automation/routing.ts`: apagar as funções `getPathValue` e `conditionMatches` inteiras e, no lugar, importar e re-exportar do contracts. O import do topo vira:

```ts
import { conditionMatches, getPathValue, MENU_DEFAULT_TIMEOUT_SECONDS, MENU_MAX_TIMEOUT_SECONDS, type AutomationDefinitionSchema } from '@nexo/contracts';

export { conditionMatches, getPathValue };
```

O resto do arquivo (`selectNextEdge`, `renderTemplate`, funções de menu) fica igual — as chamadas `conditionMatches(getPathValue(context, x.field), x)` já têm a assinatura nova.

- [ ] **Step 7: Trocar as cópias locais na API**

Em `apps/api/src/modules/playbooks/compiler.ts`:
- adicionar `conditionMatches` e `getPathValue` ao import de `@nexo/contracts`;
- apagar as funções locais `getPathValue` e `matches` inteiras;
- substituir as 3 chamadas `matches(getPathValue(variables, X.field), X.operator, X.value)` por `conditionMatches(getPathValue(variables, X.field), X)` (onde `X` é `rule` na primeira e `edge.condition` nas outras duas).

- [ ] **Step 8: Rodar tudo que depende do avaliador**

Run: `npx vitest run packages/contracts apps/runtime apps/api && npx tsc --noEmit -p apps/runtime && npx tsc --noEmit -p apps/api`
Expected: todos os testes PASS, typecheck sem saída.

- [ ] **Step 9: Commit**

```bash
git add packages/contracts/src/conditions.ts packages/contracts/src/conditions.test.ts packages/contracts/src/index.ts apps/runtime/src/automation/routing.ts apps/api/src/modules/playbooks/compiler.ts
git commit -m "feat(contracts): shared condition evaluator with in/between operators and workspace time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Runtime avalia condições sobre o estado atual

**Files:**
- Create: `apps/runtime/src/automation/live-context.ts`
- Create: `apps/runtime/src/automation/live-context.test.ts`
- Modify: `apps/runtime/src/automation/automation-engine.service.ts` (loop de `executeLocked`, logo antes de `const edge = selectNextEdge(node, definition.edges, context);` ~linha 113; novo método privado)
- Modify: `apps/runtime/src/runtime-workers.service.ts` (contexto inicial em `startTriggeredExecution`, objeto `contact:` ~linha 24 do método)

**Interfaces:**
- Consumes: `systemContext` de `@nexo/contracts` (Task 1).
- Produces:
  - `type LiveSnapshot` e `WINDOW_24H_MS = 86_400_000`
  - `liveConditionContext(snapshot: LiveSnapshot): { contact: Record<string, unknown>; conversation: Record<string, unknown>; system: SystemContext }`
  - `mergeLiveContext<T extends Record<string, unknown>>(context: T, live: ReturnType<typeof liveConditionContext>): T`

- [ ] **Step 1: Escrever os testes**

Criar `apps/runtime/src/automation/live-context.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { liveConditionContext, mergeLiveContext, type LiveSnapshot } from './live-context.js';

const snapshot = (overrides: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
  timeZone: 'America/Bahia',
  now: new Date('2026-10-15T15:00:00Z'),
  contact: { id: 'c1', name: 'Ana', phone: '+5571999990000', email: null, stage: 'new', customFields: { plano: 'pro' }, tags: [{ id: 't1', name: 'vip' }] },
  conversation: { id: 'v1', status: 'QUEUED', mode: 'AI', assigneeId: null, queue: 'Atendimento' },
  lastInboundAt: new Date('2026-10-15T10:00:00Z'),
  ...overrides
});

describe('liveConditionContext', () => {
  it('expõe ids das etiquetas, janela de 24h e sistema no fuso', () => {
    const live = liveConditionContext(snapshot());
    expect(live.contact.tagIds).toEqual(['t1']);
    expect(live.conversation.window24h).toBe(true);
    expect(live.system).toEqual({ weekday: 4, time: '12:00', date: '2026-10-15' });
  });

  it('janela fechada sem mensagem recebida ou após 24h', () => {
    expect(liveConditionContext(snapshot({ lastInboundAt: null })).conversation.window24h).toBe(false);
    expect(liveConditionContext(snapshot({ lastInboundAt: new Date('2026-10-14T15:00:00Z') })).conversation.window24h).toBe(false);
  });
});

describe('mergeLiveContext', () => {
  it('atualiza contato/conversa sem apagar chaves gravadas pelo fluxo', () => {
    const context = { contact: { name: 'Antigo', score: 90 }, conversation: { status: 'NEW' }, menu: { choice: 'a' } };
    const merged = mergeLiveContext(context, liveConditionContext(snapshot()));
    expect(merged.contact).toMatchObject({ name: 'Ana', score: 90, tagIds: ['t1'] });
    expect(merged.conversation).toMatchObject({ status: 'QUEUED', window24h: true });
    expect(merged.menu).toEqual({ choice: 'a' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/runtime/src/automation/live-context.test.ts`
Expected: FAIL — `Failed to resolve import "./live-context.js"`.

- [ ] **Step 3: Implementar `apps/runtime/src/automation/live-context.ts`**

```ts
import { systemContext } from '@nexo/contracts';

export const WINDOW_24H_MS = 86_400_000;

export type LiveSnapshot = {
  timeZone: string;
  now: Date;
  contact: { id: string; name: string | null; phone: string; email: string | null; stage: string; customFields: unknown; tags: Array<{ id: string; name: string }> };
  conversation: { id: string; status: string; mode: string; assigneeId: string | null; queue: string | null };
  lastInboundAt: Date | null;
};

// Conditions read the conversation as it is now, not as it was when the execution started.
export function liveConditionContext(snapshot: LiveSnapshot) {
  return {
    contact: { ...snapshot.contact, tagIds: snapshot.contact.tags.map(tag => tag.id) } as Record<string, unknown>,
    conversation: {
      ...snapshot.conversation,
      window24h: snapshot.lastInboundAt !== null && snapshot.now.getTime() - snapshot.lastInboundAt.getTime() < WINDOW_24H_MS
    } as Record<string, unknown>,
    system: systemContext(snapshot.now, snapshot.timeZone)
  };
}

const objectOf = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function mergeLiveContext<T extends Record<string, unknown>>(context: T, live: ReturnType<typeof liveConditionContext>): T {
  return {
    ...context,
    contact: { ...objectOf(context.contact), ...live.contact },
    conversation: { ...objectOf(context.conversation), ...live.conversation },
    system: live.system
  };
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run apps/runtime/src/automation/live-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Ligar no engine**

Em `apps/runtime/src/automation/automation-engine.service.ts`:

Adicionar o import:

```ts
import { liveConditionContext, mergeLiveContext } from './live-context.js';
```

No loop de `executeLocked`, logo **antes** da linha `const edge = selectNextEdge(node, definition.edges, context);`, inserir:

```ts
      if (node.kind === 'condition') context = mergeLiveContext(context, await this.loadLiveContext(execution.conversationId));
```

Adicionar o método privado (ao lado de `loadExecution`):

```ts
  private async loadLiveContext(conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { workspace: { select: { timezone: true } }, contact: { include: { tags: { include: { tag: true } } } } }
    });
    if (!conversation) throw new NodeExecutionError('CONVERSATION_NOT_FOUND', 'A conversa da execução não existe.');
    const lastInbound = await this.prisma.message.findFirst({ where: { conversationId, direction: 'INBOUND' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    const { contact } = conversation;
    return liveConditionContext({
      timeZone: conversation.workspace.timezone,
      now: new Date(),
      contact: { id: contact.id, name: contact.name, phone: contact.phone, email: contact.email, stage: contact.stage, customFields: contact.customFields, tags: contact.tags.map(item => ({ id: item.tag.id, name: item.tag.name })) },
      conversation: { id: conversation.id, status: conversation.status, mode: conversation.mode, assigneeId: conversation.assigneeId, queue: conversation.queue },
      lastInboundAt: lastInbound?.createdAt ?? null
    });
  }
```

Observação: `NodeExecutionError` lançado aqui está fora do `try` do `runNode`; isso é intencional e igual aos demais erros de infraestrutura — o job falha e o BullMQ refaz.

- [ ] **Step 6: Contexto inicial com `tagIds`**

Em `apps/runtime/src/runtime-workers.service.ts`, no objeto `contact:` do contexto inicial em `startTriggeredExecution`, acrescentar `tagIds` ao lado de `tags` (assim simulação e primeiras leituras já veem o campo):

```ts
tagIds: conversation.contact.tags.map(item => item.tag.id),
```

- [ ] **Step 7: Rodar a suíte do runtime e typecheck**

Run: `npx vitest run apps/runtime && npx tsc --noEmit -p apps/runtime`
Expected: PASS, typecheck sem saída.

- [ ] **Step 8: Commit**

```bash
git add apps/runtime/src/automation/live-context.ts apps/runtime/src/automation/live-context.test.ts apps/runtime/src/automation/automation-engine.service.ts apps/runtime/src/runtime-workers.service.ts
git commit -m "feat(runtime): evaluate conditions against live contact, conversation and workspace time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Catálogo de condições do editor (web, lógica pura)

**Files:**
- Create: `apps/web/src/features/playbooks/condition-catalog.ts`
- Create: `apps/web/src/features/playbooks/condition-catalog.test.ts`

**Interfaces:**
- Produces (usados pela Task 4):
  - `type ConditionOperator` (mesma lista da Task 1, declarada localmente)
  - `type ConditionRule = { field: string; operator: ConditionOperator; value?: unknown }`
  - `type ConditionGroup = 'Sistema' | 'Atendimento' | 'Atendente' | 'Campos'`
  - `type ValueKind = 'tags' | 'members' | 'weekdays' | 'timeRange' | 'date' | 'dateRange' | 'boolean' | 'text' | 'none'`
  - `type ConditionItem = { key: string; group: ConditionGroup; label: string; operators: Array<{ value: ConditionOperator; label: string }>; create: () => ConditionRule }`
  - `CONDITION_GROUPS: ConditionGroup[]`, `CONDITION_ITEMS: ConditionItem[]`, `WEEKDAY_LABELS: string[]`, `CUSTOM_FIELD_PREFIX = 'contact.customFields.'`
  - `itemForRule(rule: ConditionRule): ConditionItem`
  - `valueKind(item: ConditionItem, operator: ConditionOperator): ValueKind`
  - `searchConditionItems(query: string): ConditionItem[]`
  - `ruleError(rule: ConditionRule): string` (vazio quando válida)

- [ ] **Step 1: Escrever os testes**

Criar `apps/web/src/features/playbooks/condition-catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CONDITION_GROUPS, CONDITION_ITEMS, itemForRule, ruleError, searchConditionItems, valueKind } from './condition-catalog';

const item = (key: string) => CONDITION_ITEMS.find(entry => entry.key === key)!;

describe('condition catalog', () => {
  it('segue os grupos e itens do Leona, na ordem', () => {
    expect(CONDITION_GROUPS).toEqual(['Sistema', 'Atendimento', 'Atendente', 'Campos']);
    expect(CONDITION_ITEMS.map(entry => entry.label)).toEqual([
      'Etiqueta', 'Dia da semana', 'Hora', 'Data', 'Janela de 24h',
      'Aguardando', 'Atendendo', 'Resolvidos',
      'Atendente ativo do chat (lista)',
      'Nome', 'Número', 'Email', 'Campo personalizado', 'Variável do fluxo'
    ]);
  });

  it('cria regras com os campos e valores da spec', () => {
    expect(item('tag').create()).toEqual({ field: 'contact.tagIds', operator: 'in', value: [] });
    expect(item('time').create()).toEqual({ field: 'system.time', operator: 'between', value: ['08:00', '18:00'] });
    expect(item('waiting').create()).toEqual({ field: 'conversation.status', operator: 'equals', value: 'QUEUED' });
    expect(item('attending').create().value).toBe('ASSIGNED');
    expect(item('resolved').create().value).toBe('RESOLVED');
    expect(item('window24h').create()).toEqual({ field: 'conversation.window24h', operator: 'equals', value: true });
  });

  it('reconhece o item de uma regra salva', () => {
    expect(itemForRule({ field: 'conversation.status', operator: 'not_equals', value: 'ASSIGNED' }).key).toBe('attending');
    expect(itemForRule({ field: 'contact.customFields.plano', operator: 'equals', value: 'pro' }).key).toBe('custom');
    expect(itemForRule({ field: 'menu.choice', operator: 'equals', value: 'a' }).key).toBe('variable');
    expect(itemForRule({ field: 'contact.phone', operator: 'contains', value: '71' }).key).toBe('phone');
  });

  it('escolhe o editor de valor pelo item e operador', () => {
    expect(valueKind(item('date'), 'between')).toBe('dateRange');
    expect(valueKind(item('date'), 'equals')).toBe('date');
    expect(valueKind(item('name'), 'exists')).toBe('none');
    expect(valueKind(item('name'), 'contains')).toBe('text');
    expect(valueKind(item('waiting'), 'equals')).toBe('none');
  });

  it('busca ignorando acentos e maiúsculas, também pelo grupo', () => {
    expect(searchConditionItems('numero').map(entry => entry.key)).toEqual(['phone']);
    expect(searchConditionItems('JANELA').map(entry => entry.key)).toEqual(['window24h']);
    expect(searchConditionItems('atendimento').map(entry => entry.key)).toEqual(['waiting', 'attending', 'resolved']);
    expect(searchConditionItems('')).toHaveLength(CONDITION_ITEMS.length);
  });

  it('aponta o que falta em cada tipo de regra', () => {
    expect(ruleError({ field: 'contact.tagIds', operator: 'in', value: [] })).toBe('Selecione ao menos uma etiqueta.');
    expect(ruleError({ field: 'system.weekday', operator: 'in', value: [] })).toBe('Selecione ao menos um dia.');
    expect(ruleError({ field: 'system.time', operator: 'between', value: ['08:00', ''] })).toBe('Informe o horário inicial e final.');
    expect(ruleError({ field: 'system.date', operator: 'equals', value: '' })).toBe('Informe a data.');
    expect(ruleError({ field: 'conversation.assigneeId', operator: 'in', value: [] })).toBe('Selecione ao menos um atendente.');
    expect(ruleError({ field: 'contact.customFields.', operator: 'equals', value: 'x' })).toBe('Informe a chave do campo personalizado.');
    expect(ruleError({ field: '', operator: 'equals', value: 'x' })).toBe('Informe o caminho da variável (ex.: menu.choice).');
    expect(ruleError({ field: 'contact.name', operator: 'equals', value: '' })).toBe('Informe o valor para comparar.');
    expect(ruleError({ field: 'contact.name', operator: 'exists' })).toBe('');
    expect(ruleError({ field: 'conversation.status', operator: 'equals', value: 'QUEUED' })).toBe('');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/web/src/features/playbooks/condition-catalog.test.ts`
Expected: FAIL — `Failed to resolve import "./condition-catalog"`.

- [ ] **Step 3: Implementar `apps/web/src/features/playbooks/condition-catalog.ts`**

```ts
// Condition types offered by the Condicional block. Mirrors the operators of
// packages/contracts/src/conditions.ts; declared here so the web bundle does not pull zod in.
export type ConditionOperator = 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'exists' | 'not_exists' | 'greater_than' | 'less_than' | 'in' | 'not_in' | 'between' | 'not_between';
export type ConditionRule = { field: string; operator: ConditionOperator; value?: unknown };
export type ConditionGroup = 'Sistema' | 'Atendimento' | 'Atendente' | 'Campos';
export type ValueKind = 'tags' | 'members' | 'weekdays' | 'timeRange' | 'date' | 'dateRange' | 'boolean' | 'text' | 'none';
export type ConditionItem = { key: string; group: ConditionGroup; label: string; operators: Array<{ value: ConditionOperator; label: string }>; create: () => ConditionRule };

export const CONDITION_GROUPS: ConditionGroup[] = ['Sistema', 'Atendimento', 'Atendente', 'Campos'];
export const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const CUSTOM_FIELD_PREFIX = 'contact.customFields.';

const TEXT_OPERATORS: ConditionItem['operators'] = [
  { value: 'equals', label: 'é igual a' }, { value: 'not_equals', label: 'é diferente de' },
  { value: 'contains', label: 'contém' }, { value: 'not_contains', label: 'não contém' },
  { value: 'exists', label: 'está preenchido' }, { value: 'not_exists', label: 'está vazio' }
];
const STATUS_OPERATORS: ConditionItem['operators'] = [{ value: 'equals', label: 'está' }, { value: 'not_equals', label: 'não está' }];
const status = (key: string, label: string, value: string): ConditionItem => ({ key, group: 'Atendimento', label, operators: STATUS_OPERATORS, create: () => ({ field: 'conversation.status', operator: 'equals', value }) });
const text = (key: string, label: string, field: string): ConditionItem => ({ key, group: 'Campos', label, operators: TEXT_OPERATORS, create: () => ({ field, operator: 'equals', value: '' }) });

export const CONDITION_ITEMS: ConditionItem[] = [
  { key: 'tag', group: 'Sistema', label: 'Etiqueta', operators: [{ value: 'in', label: 'possui alguma das' }, { value: 'not_in', label: 'não possui nenhuma das' }], create: () => ({ field: 'contact.tagIds', operator: 'in', value: [] }) },
  { key: 'weekday', group: 'Sistema', label: 'Dia da semana', operators: [{ value: 'in', label: 'é um dos dias' }, { value: 'not_in', label: 'não é um dos dias' }], create: () => ({ field: 'system.weekday', operator: 'in', value: [1, 2, 3, 4, 5] }) },
  { key: 'time', group: 'Sistema', label: 'Hora', operators: [{ value: 'between', label: 'entre' }, { value: 'not_between', label: 'fora de' }], create: () => ({ field: 'system.time', operator: 'between', value: ['08:00', '18:00'] }) },
  { key: 'date', group: 'Sistema', label: 'Data', operators: [{ value: 'equals', label: 'é' }, { value: 'greater_than', label: 'depois de' }, { value: 'less_than', label: 'antes de' }, { value: 'between', label: 'entre' }], create: () => ({ field: 'system.date', operator: 'equals', value: '' }) },
  { key: 'window24h', group: 'Sistema', label: 'Janela de 24h', operators: [{ value: 'equals', label: 'está' }], create: () => ({ field: 'conversation.window24h', operator: 'equals', value: true }) },
  status('waiting', 'Aguardando', 'QUEUED'),
  status('attending', 'Atendendo', 'ASSIGNED'),
  status('resolved', 'Resolvidos', 'RESOLVED'),
  { key: 'assignee', group: 'Atendente', label: 'Atendente ativo do chat (lista)', operators: [{ value: 'in', label: 'é um dos' }, { value: 'not_in', label: 'não é nenhum dos' }], create: () => ({ field: 'conversation.assigneeId', operator: 'in', value: [] }) },
  text('name', 'Nome', 'contact.name'),
  text('phone', 'Número', 'contact.phone'),
  text('email', 'Email', 'contact.email'),
  { key: 'custom', group: 'Campos', label: 'Campo personalizado', operators: TEXT_OPERATORS, create: () => ({ field: CUSTOM_FIELD_PREFIX, operator: 'equals', value: '' }) },
  { key: 'variable', group: 'Campos', label: 'Variável do fluxo', operators: [...TEXT_OPERATORS, { value: 'greater_than', label: 'maior que' }, { value: 'less_than', label: 'menor que' }], create: () => ({ field: '', operator: 'equals', value: '' }) }
];

const byKey = (key: string) => CONDITION_ITEMS.find(item => item.key === key)!;
const FIELD_ITEMS: Record<string, string> = { 'contact.tagIds': 'tag', 'system.weekday': 'weekday', 'system.time': 'time', 'system.date': 'date', 'conversation.window24h': 'window24h', 'conversation.assigneeId': 'assignee', 'contact.name': 'name', 'contact.phone': 'phone', 'contact.email': 'email' };
const STATUS_ITEMS: Record<string, string> = { QUEUED: 'waiting', ASSIGNED: 'attending', RESOLVED: 'resolved' };

export function itemForRule(rule: ConditionRule): ConditionItem {
  if (rule.field === 'conversation.status' && typeof rule.value === 'string' && STATUS_ITEMS[rule.value]) return byKey(STATUS_ITEMS[rule.value]!);
  if (FIELD_ITEMS[rule.field]) return byKey(FIELD_ITEMS[rule.field]!);
  if (rule.field.startsWith(CUSTOM_FIELD_PREFIX)) return byKey('custom');
  return byKey('variable');
}

export function valueKind(item: ConditionItem, operator: ConditionOperator): ValueKind {
  switch (item.key) {
    case 'tag': return 'tags';
    case 'assignee': return 'members';
    case 'weekday': return 'weekdays';
    case 'time': return 'timeRange';
    case 'date': return operator === 'between' ? 'dateRange' : 'date';
    case 'window24h': return 'boolean';
    case 'waiting': case 'attending': case 'resolved': return 'none';
    default: return operator === 'exists' || operator === 'not_exists' ? 'none' : 'text';
  }
}

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function searchConditionItems(query: string): ConditionItem[] {
  const term = fold(query);
  if (!term) return CONDITION_ITEMS;
  return CONDITION_ITEMS.filter(item => fold(item.label).includes(term) || fold(item.group).includes(term));
}

const TIME = /^\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PATH = /^[A-Za-z_][\w.]*$/;
const isPair = (value: unknown, pattern: RegExp) => Array.isArray(value) && value.length === 2 && value.every(part => typeof part === 'string' && pattern.test(part));

export function ruleError(rule: ConditionRule): string {
  const item = itemForRule(rule);
  if (item.key === 'custom' && !PATH.test(rule.field.slice(CUSTOM_FIELD_PREFIX.length))) return 'Informe a chave do campo personalizado.';
  if (item.key === 'variable' && !PATH.test(rule.field)) return 'Informe o caminho da variável (ex.: menu.choice).';
  switch (valueKind(item, rule.operator)) {
    case 'tags': return Array.isArray(rule.value) && rule.value.length ? '' : 'Selecione ao menos uma etiqueta.';
    case 'members': return Array.isArray(rule.value) && rule.value.length ? '' : 'Selecione ao menos um atendente.';
    case 'weekdays': return Array.isArray(rule.value) && rule.value.length ? '' : 'Selecione ao menos um dia.';
    case 'timeRange': return isPair(rule.value, TIME) ? '' : 'Informe o horário inicial e final.';
    case 'date': return typeof rule.value === 'string' && DATE.test(rule.value) ? '' : 'Informe a data.';
    case 'dateRange': return isPair(rule.value, DATE) ? '' : 'Informe a data inicial e final.';
    case 'text': return rule.value !== undefined && rule.value !== null && String(rule.value).trim() !== '' ? '' : 'Informe o valor para comparar.';
    default: return '';
  }
}
```

Nota: para os itens `custom` e `variable`, `valueKind` devolve `'text'`; o editor (Task 4) mostra para esses dois um campo extra de chave/caminho além do valor.

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run apps/web/src/features/playbooks/condition-catalog.test.ts && npx tsc --noEmit -p apps/web`
Expected: PASS, typecheck sem saída.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/playbooks/condition-catalog.ts apps/web/src/features/playbooks/condition-catalog.test.ts
git commit -m "feat(web): condition catalog for the Condicional block

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Modal "Editar Condicional" e seletor de condições

**Files:**
- Modify: `apps/web/src/features/playbooks/PlaybookEditorPage.tsx`
- Modify: `apps/web/src/features/playbooks/flow-builder.css` (anexar ao fim)
- Modify: `docs/leona-flow-parity.md` (linha "Condicional" da tabela)

**Interfaces:**
- Consumes (Task 3): `CONDITION_GROUPS`, `CONDITION_ITEMS`, `WEEKDAY_LABELS`, `CUSTOM_FIELD_PREFIX`, `itemForRule`, `valueKind`, `searchConditionItems`, `ruleError`, `type ConditionRule`, `type ConditionOperator`.
- Consumes (existente no arquivo): `type FlowNode`, `kindMeta`, `ContactMeta` (de `../../shared/types/api`, já importado), `useState`, ícones de `lucide-react`, padrão do `MenuEditor` (mesmo arquivo) e de `saveMenu` em `PlaybookEditorPage`.

- [ ] **Step 1: Importar o catálogo e ícones**

No topo de `PlaybookEditorPage.tsx`:

```ts
import {CONDITION_GROUPS,CUSTOM_FIELD_PREFIX,WEEKDAY_LABELS,itemForRule,ruleError,searchConditionItems,valueKind,type ConditionOperator,type ConditionRule} from './condition-catalog';
```

e acrescentar `ChevronLeft` ao import existente de `lucide-react` (`GitBranch`, `Plus`, `Search`, `X` já estão importados).

- [ ] **Step 2: Componente `ConditionEditor`**

Inserir logo antes de `function EdgeInspector(`:

```tsx
type ConditionMember={id:string;name:string};
function ConditionValue({rule,tags,members,onChange}:{rule:ConditionRule;tags:ContactMeta['tags'];members:ConditionMember[];onChange:(patch:Partial<ConditionRule>)=>void}){
  const item=itemForRule(rule);const kind=valueKind(item,rule.operator);
  const list=Array.isArray(rule.value)?rule.value as unknown[]:[];
  const toggle=(value:unknown)=>onChange({value:list.includes(value)?list.filter(entry=>entry!==value):[...list,value]});
  const pair=Array.isArray(rule.value)?rule.value as string[]:['',''];
  const setPair=(index:0|1,value:string)=>onChange({value:index===0?[value,pair[1]??'']:[pair[0]??'',value]});
  return <>
    {item.key==='custom'&&<label>Chave do campo<input value={rule.field.slice(CUSTOM_FIELD_PREFIX.length)} onChange={event=>onChange({field:CUSTOM_FIELD_PREFIX+event.target.value.trim()})} placeholder="Ex.: plano"/></label>}
    {item.key==='variable'&&<label>Caminho da variável<input value={rule.field} onChange={event=>onChange({field:event.target.value.trim()})} placeholder="Ex.: menu.choice"/></label>}
    {kind==='tags'&&(tags.length?<div className="condition-checks">{tags.map(tag=><label key={tag.id} className="check-field"><input type="checkbox" checked={list.includes(tag.id)} onChange={()=>toggle(tag.id)}/><i style={{background:tag.color}}/>{tag.name}</label>)}</div>:<p className="field-help">Nenhuma etiqueta cadastrada ainda.</p>)}
    {kind==='members'&&(members.length?<div className="condition-checks">{members.map(member=><label key={member.id} className="check-field"><input type="checkbox" checked={list.includes(member.id)} onChange={()=>toggle(member.id)}/>{member.name}</label>)}</div>:<p className="field-help">Nenhum membro no workspace.</p>)}
    {kind==='weekdays'&&<div className="condition-weekdays" role="group" aria-label="Dias da semana">{WEEKDAY_LABELS.map((label,day)=><button type="button" key={label} aria-pressed={list.includes(day)} className={list.includes(day)?'active':''} onClick={()=>toggle(day)}>{label}</button>)}</div>}
    {kind==='timeRange'&&<><div className="duration-fields"><label>De<input type="time" value={pair[0]??''} onChange={event=>setPair(0,event.target.value)}/></label><label>Até<input type="time" value={pair[1]??''} onChange={event=>setPair(1,event.target.value)}/></label></div><p className="field-help">Se o início for depois do fim, vale a virada da noite (ex.: 22:00 até 06:00). Usa o fuso do workspace.</p></>}
    {kind==='date'&&<label>Data<input type="date" value={typeof rule.value==='string'?rule.value:''} onChange={event=>onChange({value:event.target.value})}/></label>}
    {kind==='dateRange'&&<div className="duration-fields"><label>De<input type="date" value={pair[0]??''} onChange={event=>setPair(0,event.target.value)}/></label><label>Até<input type="date" value={pair[1]??''} onChange={event=>setPair(1,event.target.value)}/></label></div>}
    {kind==='boolean'&&<label>Situação<select value={rule.value===false?'false':'true'} onChange={event=>onChange({value:event.target.value==='true'})}><option value="true">Dentro da janela de 24h</option><option value="false">Fora da janela de 24h</option></select></label>}
    {kind==='text'&&<label>Valor<input value={String(rule.value??'')} onChange={event=>onChange({value:event.target.value})}/></label>}
  </>
}
function ConditionEditor({node,tags,members,onSave,onCancel}:{node:FlowNode;tags:ContactMeta['tags'];members:ConditionMember[];onSave:(name:string,config:Record<string,unknown>)=>void;onCancel:()=>void}){
  const initial=node.data.config;
  const [name,setName]=useState(node.data.name);
  const [logic,setLogic]=useState<'all'|'any'>(initial.logic==='any'?'any':'all');
  const [rules,setRules]=useState<ConditionRule[]>(()=>Array.isArray(initial.rules)?initial.rules as ConditionRule[]:[]);
  const [picking,setPicking]=useState(false);
  const [query,setQuery]=useState('');
  const [submitted,setSubmitted]=useState(false);
  const results=searchConditionItems(query);
  const errors=rules.map(ruleError);
  const listError=rules.length===0?'Adicione ao menos uma condição.':'';
  const updateRule=(index:number,patch:Partial<ConditionRule>)=>setRules(rules.map((rule,itemIndex)=>itemIndex===index?{...rule,...patch}:rule));
  function save(){setSubmitted(true);if(listError||errors.some(Boolean))return;onSave(name.trim()||kindMeta.condition.label,{...initial,logic,rules})}

  if(picking)return <><header className="condition-picker-head"><button type="button" className="condition-back" aria-label="Voltar para as condições" onClick={()=>setPicking(false)}><ChevronLeft size={18}/></button><div><b>Adicionar condição ao fluxo</b><small>Defina as condições e regra lógica para que o fluxo continue pela saída superior deste bloco:</small></div></header>
  <div className="inspector-form condition-picker">
    <label htmlFor="condition-search">Selecionar condição</label>
    <div className="condition-search"><Search size={16} aria-hidden="true"/><input id="condition-search" autoFocus type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar condição..."/></div>
    {results.length===0&&<p className="palette-empty">Nenhuma condição encontrada para “{query}”.</p>}
    {CONDITION_GROUPS.map(group=>{const items=results.filter(item=>item.group===group);return items.length?<section key={group} className={`condition-group group-${group.toLowerCase()}`}><b>{group}</b>{items.map(item=><button type="button" key={item.key} onClick={()=>{setRules([...rules,item.create()]);setPicking(false);setQuery('')}}>{item.label}</button>)}</section>:null})}
  </div></>;

  return <><header><span className="palette-icon condition"><GitBranch size={16} aria-hidden="true"/></span><div><small>BLOCO SELECIONADO</small><b>Editar Condicional</b></div></header>
  <div className="inspector-form condition-editor">
    <label>Nome do bloco<input value={name} onChange={event=>setName(event.target.value)} maxLength={120}/></label>
    <fieldset className="condition-logic"><legend>Regra Lógica</legend>
      <label className="radio-field"><input type="radio" name="condition-logic" checked={logic==='all'} onChange={()=>setLogic('all')}/> <span>Regra corresponde a <strong>todas</strong> as condições (e)</span></label>
      <label className="radio-field"><input type="radio" name="condition-logic" checked={logic==='any'} onChange={()=>setLogic('any')}/> <span>Regra corresponde a <strong>qualquer</strong> condição (ou)</span></label>
    </fieldset>
    <div className="menu-options-head"><b>Condições</b><button type="button" className="menu-add" onClick={()=>setPicking(true)} disabled={rules.length>=20} title={rules.length>=20?'Limite de 20 condições':undefined}><Plus size={16} aria-hidden="true"/> Adicionar Condição</button></div>
    {rules.length===0
      ? <div className={`menu-options-empty ${submitted&&listError?'invalid':''}`}><GitBranch size={26} aria-hidden="true"/><p>Nenhuma condição adicionada. Clique em “Adicionar Condição” para começar.</p></div>
      : <ol className="menu-options condition-rules">{rules.map((rule,index)=>{const item=itemForRule(rule);return <li key={index}>
          <span className="menu-option-index" aria-hidden="true">{index+1}</span>
          <div>
            <div className="condition-rule-head"><b>{item.label}</b><small>{item.group}</small></div>
            {item.operators.length>1&&<label>Operador<select value={rule.operator} onChange={event=>updateRule(index,{operator:event.target.value as ConditionOperator,...(valueKind(item,event.target.value as ConditionOperator)!==valueKind(item,rule.operator)?{value:item.create().value}:{})})}>{item.operators.map(operator=><option key={operator.value} value={operator.value}>{operator.label}</option>)}</select></label>}
            <ConditionValue rule={rule} tags={tags} members={members} onChange={patch=>updateRule(index,patch)}/>
            {submitted&&errors[index]&&<small className="field-error">{errors[index]}</small>}
          </div>
          <button type="button" className="menu-option-remove" aria-label={`Remover condição ${index+1}`} title="Remover condição" onClick={()=>setRules(rules.filter((_,itemIndex)=>itemIndex!==index))}><X size={16}/></button>
        </li>})}</ol>}
    {submitted&&listError&&<small className="field-error">{listError}</small>}
    <footer className="menu-actions"><button type="button" onClick={onCancel}>Cancelar</button><button type="button" className="primary" onClick={save}>Salvar</button></footer>
  </div></>
}
```

Nota: ao trocar o operador da Data entre "é"/"depois de"/"antes de" (valor simples) e "entre" (par), o valor é reiniciado com o padrão do item, porque o formato muda; para os demais itens o tipo de valor não muda e o valor é mantido.

- [ ] **Step 3: Ligar no modal**

Em `PlaybookEditorPage`, ao lado de `saveMenu`, adicionar:

```ts
  function saveCondition(name:string,config:Record<string,unknown>){updateSelected({name,config});setInspectorOpen(false)}
```

No JSX do modal, onde hoje está `selectedNode.data.kind==='buttons' ? <MenuEditor …/> : <NodeInspector …/>`, inserir o ramo da Condicional antes do `NodeInspector`:

```tsx
            : selectedNode.data.kind==='condition'
              ? <ConditionEditor key={selectedNode.id} node={selectedNode} tags={contactMeta.data?.tags??[]} members={contactMeta.data?.members??[]} onSave={saveCondition} onCancel={()=>setInspectorOpen(false)}/>
```

- [ ] **Step 4: Remover o formulário antigo da Condicional**

No `NodeInspector`, apagar a linha inteira que começa com `    {kind==='condition'&&<><label>Combinação` (ela termina com o callout "Duas saídas") e a constante local `const conditionRules=Array.isArray(config.rules)?…;` que só ela usava. Rodar `npx tsc --noEmit -p apps/web` para confirmar que nada mais referenciava os dois.

- [ ] **Step 5: CSS**

Anexar ao fim de `apps/web/src/features/playbooks/flow-builder.css`:

```css
.condition-logic{border:0;padding:0;margin:0 0 18px;min-width:0;display:grid;gap:8px}.condition-logic legend{padding:0;margin-bottom:8px;font-size:12px;font-weight:800;color:#33433c}.condition-editor .radio-field{display:flex;align-items:center;gap:10px;margin:0;font-size:12px;font-weight:500;color:#33433c;cursor:pointer}.radio-field input{width:16px!important;height:16px;margin:0;accent-color:var(--green)}.radio-field strong{font-weight:800}
.condition-rule-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.condition-rule-head b{font-size:12px;color:#33433c}.condition-rule-head small{font-size:10px;color:#8a958f}.condition-rules li>div>label{margin:0}
.condition-checks{display:grid;gap:6px;max-height:180px;overflow:auto}.condition-checks .check-field{margin:0;font-size:11px;font-weight:600}.condition-checks i{width:9px;height:9px;border-radius:50%}
.condition-weekdays{display:flex;flex-wrap:wrap;gap:6px}.condition-weekdays button{min-width:44px;min-height:36px;border:1px solid var(--line);border-radius:9px;background:#fff;color:#385f50;font-size:11px;font-weight:700}.condition-weekdays button.active{background:var(--green);border-color:var(--green);color:#fff}.condition-weekdays button:focus-visible,.condition-group button:focus-visible,.condition-back:focus-visible{outline:2px solid #5d9b82;outline-offset:2px}
.condition-picker-head{display:grid!important;grid-template-columns:34px 1fr;align-items:start;gap:10px}.condition-picker-head b{display:block;font-size:14px;color:#18231f}.condition-picker-head small{display:block;margin-top:4px;font-size:11px;line-height:1.45;color:#75827b}.condition-back{display:grid;place-items:center;width:34px;height:34px;border:1px solid var(--line);border-radius:9px;background:#fff;color:#385f50}
.condition-search{position:relative;margin-bottom:14px}.condition-search svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#8a958f;pointer-events:none}.flow-inspector .condition-search input{padding-left:36px;min-height:42px}
.condition-group{display:grid;gap:2px;margin-bottom:10px;padding:12px;border-radius:12px}.condition-group>b{margin:0 0 6px;font-size:12px;color:#26352f}.condition-group button{text-align:left;min-height:40px;padding:0 12px;border:0;border-radius:8px;background:transparent;color:#2f403a;font-size:12px}.condition-group button:hover{background:#ffffffb3}
.group-sistema{background:#e7f2f4}.group-atendimento{background:#e9eef9}.group-atendente{background:#efeaf8}.group-campos{background:#e8f3ec}
```

- [ ] **Step 6: Atualizar o documento de paridade**

Em `docs/leona-flow-parity.md`, substituir a linha que começa com `| Condicional | Condicional |` por:

```markdown
| Condicional | Condicional | Pronto | Editor com Regra Lógica (todas/qualquer) e catálogo de condições: etiqueta, dia da semana, hora, data, janela de 24h, status do atendimento, atendente, nome, número, email, campo personalizado e variável do fluxo. O runtime avalia sobre o estado atual da conversa, no fuso do workspace. |
```

- [ ] **Step 7: Verificar**

Run: `npx tsc --noEmit -p apps/web && npx vitest run apps/web && npx vite build apps/web`
Expected: typecheck sem saída, testes PASS, build termina com `✓ built`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/playbooks/PlaybookEditorPage.tsx apps/web/src/features/playbooks/flow-builder.css docs/leona-flow-parity.md
git commit -m "feat(web): Leona-style condition editor with searchable condition picker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
