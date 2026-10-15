# Condicional no padrão Leona — spec

Data: 15/10/2026. Referência: prints "Editar Condicional" e "Adicionar condição ao fluxo" do Leona.

## Problema

O bloco Condicional do Nexo pede campo/operador/valor em texto livre e avalia um **retrato do contexto tirado no início da execução** (`runtime-workers.service.ts`, `startTriggeredExecution`). Etiquetas, status e atendente mudam durante o fluxo (blocos Etiquetas, Departamento, Handoff, ou depois de um Intervalo de dias), então qualquer condição sobre eles lê dado velho. Além disso `contact.tags` é uma lista de objetos `{id,name}`, e `contains` com texto nunca casa.

## Comportamento desejado

### Editor (modal "Editar Condicional")
- **Regra Lógica**: rádios "Regra corresponde a **todas** as condições (e)" (`logic: 'all'`) e "Regra corresponde a **qualquer** condição (ou)" (`logic: 'any'`).
- **Condições** + botão "Adicionar Condição"; estado vazio tracejado: "Nenhuma condição adicionada. Clique em "Adicionar Condição" para começar."
- "Adicionar Condição" abre o seletor "Adicionar condição ao fluxo", subtítulo "Defina as condições e regra lógica para que o fluxo continue pela saída superior deste bloco:", rótulo "Selecionar condição", busca "Buscar condição...", grupos:
  - **Sistema**: Etiqueta, Dia da semana, Hora, Data, Janela de 24h
  - **Atendimento**: Aguardando, Atendendo, Resolvidos
  - **Atendente**: Atendente ativo do chat (lista)
  - **Campos**: Nome, Número, Email, Campo personalizado, Variável do fluxo
- Cada condição adicionada vira uma linha editável (operador + valor próprios do tipo) com remover.
- Cancelar / Salvar editam um rascunho (mesmo padrão do modal do Menu). Máximo de 20 condições.

### Semântica de cada condição (regra `{field, operator, value}`)

| Item | field | operadores | value |
|---|---|---|---|
| Etiqueta | `contact.tagIds` | `in` (possui alguma das), `not_in` (não possui nenhuma das) | ids de etiquetas |
| Dia da semana | `system.weekday` | `in`, `not_in` | números 0 (Dom) a 6 (Sáb) |
| Hora | `system.time` | `between`, `not_between` | `["HH:MM","HH:MM"]`; início > fim cruza a meia-noite |
| Data | `system.date` | `equals`, `greater_than` (depois de), `less_than` (antes de), `between` | `"YYYY-MM-DD"` ou par |
| Janela de 24h | `conversation.window24h` | `equals` | `true` (dentro) / `false` (fora) |
| Aguardando / Atendendo / Resolvidos | `conversation.status` | `equals`, `not_equals` | `QUEUED` / `ASSIGNED` / `RESOLVED` |
| Atendente ativo do chat (lista) | `conversation.assigneeId` | `in`, `not_in` | ids de membros |
| Nome / Número / Email | `contact.name` / `contact.phone` / `contact.email` | `equals`, `not_equals`, `contains`, `not_contains`, `exists`, `not_exists` | texto |
| Campo personalizado | `contact.customFields.<chave>` | mesmos de texto | texto |
| Variável do fluxo | qualquer caminho (`menu.choice`, `integration.response.x`) | texto + `greater_than`, `less_than` | texto/número |

- `system.*` usa o fuso do workspace (`Workspace.timezone`, padrão `America/Bahia`); fuso inválido cai em `UTC`.
- `conversation.window24h` é verdadeiro quando a última mensagem **recebida** do contato tem menos de 24h.
- Operadores novos: `in`/`not_in` (valor é lista; se o campo também for lista, basta qualquer interseção), `between`/`not_between` (par inclusivo; início > fim = intervalo que dá a volta). `greater_than`/`less_than` passam a comparar também texto com texto (datas ISO e horários).

### Runtime
- Antes de avaliar um bloco Condicional, o engine recarrega do banco `contact` (com `tagIds`), `conversation` (status, assigneeId, queue, mode, `window24h`) e `system` (weekday, time, date), mesclando sobre o contexto da execução sem apagar chaves gravadas pelo fluxo.
- A avaliação (`conditionMatches`) vive num único lugar compartilhado por API (validação/simulação) e runtime.

## Fora de escopo
- Condições dos demais itens do Leona não listados acima (Kanban, pixel, etc.).
- Mudar a forma das saídas do bloco (continua: saída "Condição atendida" + "Caso contrário").
