# Automação de WhatsApp e construtor de fluxos: especificação para reimplementar

Este documento descreve a automação de WhatsApp e o construtor de fluxos do Nexo com detalhe
suficiente para reconstruir ambos em outra base de código, em outra linguagem se for o caso.

Ele não é um tutorial da nossa base: é a lista do que precisa existir, por quê, e **onde nós
erramos**. A seção [Armadilhas](#8-armadilhas-que-nos-custaram-caro) é a parte mais valiosa — cada
item ali é um bug que chegou a existir no código e custou tempo para encontrar. Ler só ela já reduz
falhas.

Escrito em 29/10/2026, a partir do código em `packages/contracts`, `packages/domain`,
`apps/runtime/src/automation` e `apps/api/src/modules/playbooks`.

---

## 1. As quatro peças obrigatórias

Qualquer reimplementação precisa separar estas quatro responsabilidades. A separação não é estética:
cada fronteira existe porque atravessá-la causou problema.

| Peça | Responsabilidade | Por que separada |
|---|---|---|
| **Contratos** | Schemas de validação do JSON do fluxo e de cada config de bloco | É o único lugar onde a forma do fluxo é definida. Editor, API e motor validam contra o mesmo schema |
| **Domínio puro** | Seleção de aresta, interpolação, escrita no contexto, cálculo de espera, condições | Sem I/O, sem banco, sem relógio implícito. É o que permite um simulador que não divirja do motor |
| **Motor** | Executa um passo por vez, persiste estado, agenda retomadas | Único dono do estado da execução |
| **Editor** | Desenha o grafo e edita as configs | Consome só os **tipos** dos contratos, nunca os valores |

**A regra que mais nos poupou:** o editor importa apenas tipos dos contratos, nunca valores. As
constantes que o editor precisa (rótulos, limites, catálogo de condições) são espelhadas localmente.
Sem isso, o bundle do front arrasta zod e dependências de servidor. Se a sua stack não tem essa
separação, duplique as constantes de propósito e deixe um teste que compare as duas listas.

**A regra que compramos com dor:** a lógica de caminhar o grafo existe **uma vez**, no domínio puro,
e o motor a importa. Enquanto o simulador tinha a própria cópia, as duas divergiram em silêncio e o
simulador aprovava fluxos que quebravam em produção.

---

## 2. O contrato do fluxo

Um fluxo é um grafo dirigido, versionado, guardado como JSON:

```jsonc
{
  "start": "node-1",              // id do nó inicial
  "nodes": [
    {
      "id": "node-1",             // 1..80 caracteres, único
      "kind": "message",          // uma das 22 variedades
      "name": "Boas-vindas",      // rótulo no canvas, 1..120
      "config": { },              // forma depende de kind
      "position": { "x": 100, "y": 180 }
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "source": "node-1",
      "target": "node-2",
      "port": "success",          // success | failure | reply | timeout (ausente = success)
      "condition": {              // só em condicional e menu
        "field": "contact.stage",
        "operator": "equals",
        "value": "qualified"
      },
      "isDefault": false,         // o caminho "caso contrário"
      "priority": 0               // menor primeiro
    }
  ],
  "settings": { "maxSteps": 30, "timeoutSeconds": 300 }
}
```

**Limites que aplicamos:** 100 nós, 200 arestas, `maxSteps` de 1 a 100, `timeoutSeconds` de 5 a
3600. Os limites de nós e arestas não são arbitrários: sem eles, um fluxo importado com 500 nós
derruba a validação e o editor.

**Versionamento:** cada salvamento cria uma versão nova e imutável. A publicação aponta a versão
ativa. Uma execução guarda **o id da versão**, não o do fluxo — uma execução em andamento precisa
terminar com a definição com que começou. Sem isso, editar um fluxo quebra conversas em curso.

**Salvamento otimista:** o salvamento manda `expectedVersion`; divergência responde 409. Dois
atendentes no mesmo fluxo é comum.

---

## 3. Os 22 blocos

`kind` é a chave. Os blocos marcados com portas escolhem a saída em tempo de execução
(seção [5](#5-selecao-de-aresta)); os outros seguem a primeira aresta.

| kind | O que faz | Portas | Config essencial |
|---|---|---|---|
| `trigger` | Ponto de entrada, não executa nada | — | `event` (`message.received`, `tag.added`, `conversation.created`), `oncePerContact` |
| `message` | Sequência de conteúdos (texto, mídia, arquivo, contato, sticker, pausa) | — | `items[]`, até 30 |
| `image` / `audio` / `sticker` | Um conteúdo só, formato antigo | — | `url`, `caption`, `ptt` |
| `buttons` | Menu de opções | por opção + `timeout` | `mode` (`buttons` até 3, `list` até 10), `text`, `buttons[]`, `timeoutSeconds` |
| `condition` | Ramifica por regras sobre o contexto | — (usa `isDefault`) | `logic` (`all`/`any`), `rules[]` até 20 |
| `delay` | Espera | — | `mode`: `duration`, `date` ou `schedule` |
| `wait_response` | Para e espera o contato responder | `reply`, `timeout` | `waitIndefinitely`, `timeoutValue`+`timeoutUnit`, `bufferSeconds`, `saveReplyTo`, `message` |
| `ai` | Chama o modelo, classifica e roteia | `success`, `failure` + rotas | `systemPrompt`, `userMessage`, `smartConditionals[]`, `identifyReceipt`, `responseVariable` |
| `agent` | Delega a um agente configurado | — | `agentId` |
| `webhook` | Requisição HTTP e leitura da resposta | `success`, `failure` | `url`, `method`, `headers`, `body`, `responseFields[]` |
| `manipulator` | Escreve em campo do contato ou variável do fluxo | `success`, `failure` | `target`, `operation` (definir, somar, subtrair, multiplicar, dividir), `value` |
| `assign` | Atribui departamento e responsável | — | `departmentId`, `assigneeId` |
| `tag` | Adiciona ou remove etiquetas | — | `mode`, `tagIds[]` |
| `handoff` | Controlador de chat | — | `state` (`AWAITING`/`ATTENDING`/`RESOLVED`), `departmentId`, `reason`, `returnToAi` |
| `kanban` | Cria ou move cartão | — | `boardId`, `columnId`, `mode` |
| `pixel` | Evento de conversão para o Facebook | `success`, `failure` | `pixelId`, `eventName`, `value`, `currency` |
| `flow_jump` | Salta para outro fluxo, com teto de 10 saltos encadeados | — | `targetPlaybookId` |
| `distributor` | Reparte contatos entre saídas por peso | por saída | `outputs[]` (2 a 10, com `weight`), `preventRepeat` |
| `notification` | Avisa um número interno | — | `phone` (E.164), `message` |
| `outcome` | Registra desfecho e encerra | terminal | `type` |

### Decisões de forma que valem copiar

- **`strict()` em toda config.** Campo desconhecido é erro, não silêncio. Pegou vários erros de
  importação que, aceitos, teriam virado comportamento invisível.
- **Configs legadas normalizam na leitura, nunca são reescritas em massa.** O controlador de chat
  aceita `{queue, reason}` antigo e deduz `state: 'ATTENDING'`; o delay aceita `{seconds}`. Migração
  de dados em massa de JSON é irreversível quando dá errado; normalizar na leitura não é.
- **Valor de bloco antigo nunca é rejeitado.** `typingSeconds` mínimo virou 3 s, mas fluxos salvos
  com 1 ou 2 são **lidos como 3** em vez de falharem a publicação. Um fluxo no ar tem que continuar
  publicável depois de um aperto de regra.

---

## 4. O motor

### Estados

`Execution`: `RUNNING` → `WAITING` → `RUNNING` → `SUCCEEDED` | `FAILED` | `CANCELLED`.
`ExecutionStep` por nó visitado: `RUNNING` → `SUCCEEDED` | `FAILED`, com `input` e `output`.

Os passos não são só auditoria: é por eles que a retomada sabe onde estava, e o contador de passos
`SUCCEEDED` é o que aplica `maxSteps` entre retomadas.

### O laço

```
trava distribuída no id da execução (sem ela, dois workers executam o mesmo nó)
  carrega execução; se terminal, sai
  se WAITING: confirma que o job é o esperado (ver "retomada"); se não, sai
  valida a definição da versão
  enquanto houver nó atual:
    se passos >= maxSteps → falha MAX_STEPS_EXCEEDED
    relê status e contexto do banco (cancelamento no meio é respeitado)
    seleciona a aresta de saída ANTES de executar o nó
    cria ou reaproveita o passo RUNNING daquele nó
    executa o nó → 'continue' | 'waiting' | 'terminal' | { next }
    sem próximo nó → execução SUCCEEDED
```

**Dois detalhes que não são óbvios:**

1. **A aresta é escolhida antes do nó executar.** O nó recebe `nextNodeId` já resolvido. Isso é o
   que permite ao bloco detectar que *não tem* saída e encerrar o fluxo de propósito.
2. **O contexto é relido do banco a cada volta**, não carregado uma vez. Um nó pode gravar contexto
   dentro da própria transação, e a volta seguinte precisa ver isso.

### Esperas e retomada

Três tipos, cada um com a própria marca no contexto, sob uma chave `_runtime`:

| Marca | Quem espera | Retomada |
|---|---|---|
| `pendingDelayStepId` | `delay` | job agendado, ação `resume` |
| `pendingWait {stepId, nodeId, kind}` | `wait_response`, menu | mensagem recebida (`menu_reply`) ou estouro (`menu_timeout`) |
| `pendingSequence {stepId, index}` | item de mensagem no meio de uma sequência | o worker de envio chama de volta no `index + 1` |

**A regra de ouro da retomada:** ao acordar, o motor **confirma que o job corresponde à espera
registrada** antes de continuar. Job de delay só retoma se `pendingDelayStepId` for aquele passo;
sequência só se o índice for exatamente o seguinte. Sem essa checagem, um job duplicado ou atrasado
avança o fluxo duas vezes — e em WhatsApp isso é mensagem repetida para o cliente.

**Idempotência:** todo job agendado tem `jobId` fixo e derivado — por exemplo
`automation-seq-<stepId>-<index>`. Tanto o motor (ao pausar) quanto o worker de envio (ao confirmar
o envio) agendam a continuação; com `jobId` fixo, a fila descarta a segunda. **Não dá para confiar
em "só um lugar agenda":** nós tentamos, e a retentativa do worker depois de um envio já confirmado
reintroduziu o envio duplicado.

### Falha

Erro de nó carrega um código (`CHANNEL_UNAVAILABLE`, `EMPTY_MESSAGE`, `INVALID_NODE_CONFIG`…), marca
o passo como `FAILED` com o motivo, e grava o código no contexto para que a tela mostre o que
aconteceu. Códigos genéricos custam horas de depuração depois.

---

## 5. Seleção de aresta

A parte mais sutil do sistema. A regra completa:

```
candidatas = arestas com source = nó, ordenadas por priority (menor primeiro)

se o nó é menu E tem saída por opção:
    primeira cuja condition casa com o contexto, senão a isDefault
se o nó não é condicional:
    a primeira candidata
senão (condicional):
    se tem rules: avalia todas; logic 'all' exige todas, 'any' exige uma
        casou   → primeira candidata que NÃO é isDefault
        não casou → a candidata isDefault
    sem rules: primeira cuja condition casa, senão a isDefault
```

**Blocos com portas** não passam por aqui: eles escolhem a porta (`success`, `failure`, `reply`,
`timeout`) e o motor procura a aresta daquela porta.

### A decisão de produto que simplificou tudo

**Saída não conectada encerra o fluxo.** Não é erro de publicação, é aviso. Uma condicional sem o
caminho "caso contrário" simplesmente termina a conversa quando a condição não bate.

Essa escolha veio de paridade com o Leona, e destravou funis importados que não publicavam. Se você
está reimplementando, decida isso cedo: a alternativa (exigir todas as saídas conectadas) obriga o
usuário a desenhar blocos de fim por todo canto.

### Aresta sem porta vale `success`

Arestas salvas antes das portas existirem não têm `port`. Elas são lidas como `success`. Qualquer
esquema de portas adicionado depois precisa desse padrão, ou todo fluxo antigo perde as saídas.

---

## 6. Contexto e interpolação

O contexto é um objeto JSON que acompanha a execução. Grupos que entregamos:

| Caminho | Origem |
|---|---|
| `contact.name`, `contact.firstName`, `contact.phone`, `contact.email`, `contact.stage`, `contact.tagIds` | contato, relido no momento da condicional |
| `conversation.status`, `conversation.mode`, `conversation.queue`, `conversation.window24h` | conversa, relida no momento da condicional |
| `system.date`, `system.time`, `system.weekday` | relógio, no fuso do workspace |
| `last_message`, `last_message_type` | última mensagem recebida |
| `menu.choice` | opção escolhida no menu |
| `ai.response`, `ai.route`, `ai.receiptValid` | bloco de IA |
| `comprovante.valor`, `.nome_pagador`, `.data`, `.referencia` | leitura estruturada de comprovante |
| `global.*` | variáveis globais do workspace |
| `_runtime` | estado interno do motor, nunca exibido ao usuário |

**Interpolação:** `{{caminho}}`, com `undefined` e `null` virando string vazia e objeto virando
JSON. Regex: `/\{\{\s*([\w.-]+)\s*\}\}/g`.

**Condicionais releem o contato e a conversa do banco antes de avaliar.** Uma condição sobre etiqueta
precisa ver a etiqueta aplicada há dois segundos por um atendente, não o retrato do início da
execução. Esse "contexto vivo" é mesclado só nos nós condicionais, para não pesar cada passo.

**Variáveis globais não são persistidas no contexto.** Elas entram via
`Object.defineProperty(..., {enumerable: false})`, então ficam legíveis para a interpolação e **não
são serializadas** junto do contexto da execução. Uma chave PIX ou token guardado como variável
global não pode ficar gravado em cada passo de cada execução para sempre.

---

## 7. O caminho de uma mensagem

Nenhum nó fala com o WhatsApp direto. O caminho é sempre:

```
nó                → cria Message (PENDING) + evento de outbox, na MESMA transação
outbox (relay)    → vira job na fila de saída
worker de saída   → presença "digitando" → envia pelo Baileys → Message SENT + externalId
                  → libera a continuação da sequência (jobId fixo)
```

**Por que outbox e não enfileirar direto:** a mensagem e a intenção de enviar nascem na mesma
transação. Se o processo morre entre `commit` e `enqueue`, a mensagem existiria sem nunca ser
enviada. O relay varre o outbox a cada segundo.

**`availableAt` no evento de outbox é o agendador mais barato que existe.** Mensagem agendada e
disparo em massa não têm fila própria: criam eventos com `availableAt` no futuro. Retentativa,
cancelamento (marcar `processedAt`) e ordenação vêm de graça. Se a sua stack tem outbox, use isso
antes de montar um scheduler.

**Sequência de conteúdos:** um bloco de mensagem com N itens envia **um por vez**, cada um liberando
o próximo depois do envio confirmado. A pausa entre itens é um item do tipo `pause` com faixa
aleatória. Não envie os N de uma vez: o WhatsApp entrega fora de ordem e o número fica marcado.

---

## 8. Armadilhas que nos custaram caro

Cada item aqui é um bug que existiu no código.

### 8.1 Poluição de protótipo na escrita de contexto (segurança)

A função que grava no contexto (`setContextPath`) recebia caminho do usuário — webhook, IA,
manipulador. Com `__proto__.x` como caminho, ela envenenava `Object.prototype` **do processo
inteiro, atravessando workspaces**.

```js
// correção, no sink compartilhado
if (parts.some(p => p === '__proto__' || p === 'constructor' || p === 'prototype')) return next;
```

Corrija **no ponto único de escrita**, não em cada chamador. Tínhamos três chamadores e dois estavam
desprotegidos.

### 8.2 Escape de vCard que era um no-op

```js
value.replace(/;/g, '\;')   // ERRADO: '\;' === ';' em JS. Não faz nada.
value.replace(/;/g, '\;')  // certo
```

Pior: **o teste usava o mesmo literal errado**, então nunca poderia falhar. Ao escrever teste de
escape, use `String.raw` ou escreva a saída esperada caractere por caractere.

### 8.3 O teste que não pega o bug

Duas vezes um teste passou com o bug reintroduzido. A técnica que resolveu: **reintroduza o bug de
propósito e confirme que o teste falha**. Em lógica de escape, ritmo, fuso e idempotência, faça
isso sempre. No disparo em massa, meu primeiro teste de virada de dia passava com a mutação — a
asserção certa não era "os horários crescem", era "a distância entre envios consecutivos nunca fica
abaixo do mínimo".

### 8.4 Classe de CSS que nunca casava

O destaque do nó ativo no simulador — a função principal da tela — era invisível, porque a regra era
`.no-ativo .no` e a biblioteca de grafo põe a classe no elemento **de fora**: `.grafo__no.ativo .no`.
O padrão certo já existia no mesmo arquivo, três linhas acima. Ao estilizar nó de grafo, confirme
em qual elemento a classe cai.

### 8.5 Mensagem vazia depois da interpolação

`{{nome}}` com a variável ausente vira string vazia, e o WhatsApp recusa mensagem vazia. Produção
lançava `EMPTY_MESSAGE`; o simulador **aceitava** e seguia. Validadores e simuladores precisam
recusar exatamente o que produção recusa, ou aprovam fluxos que quebram no cliente.

### 8.6 Encerrar conversa duas vezes

A transição para "resolvido" disparava um evento que mandava mensagem de encerramento. Retentativa
ou dois cliques mandavam duas. A correção é **reivindicar a transição condicionalmente**:

```sql
UPDATE ... WHERE id = ? AND status <> 'RESOLVED'
-- 0 linhas afetadas = outro já resolveu: não emite nada
```

O mesmo padrão resolveu "apagar mensagem ao aplicar etiqueta": a regra sai de `PENDING` para
`REQUESTED` com `updateMany` condicional, e só quem conseguiu a mudança enfileira a exclusão.

### 8.7 Arquivar um fluxo tornou outro insalvável

O fluxo A saltava para o B. Arquivar o B fez a validação de A produzir erro; o salvamento recusa
qualquer erro; resultado: 422 e trabalho perdido ao editar A. **Mudança de estado em um registro não
pode tornar outro insalvável.** Destino inexistente é erro; destino arquivado é aviso.

### 8.8 Comparação de status por substring

O importador reconhecia status com `includes`, e `"unresolved"` casava com `RESOLVED`. Comparação de
enum é sempre exata e ancorada. Valor não reconhecido vai para um padrão seguro **e deixa uma
pendência visível** — nunca adivinhe em silêncio.

### 8.9 Fuso horário errado em espera agendada

O simulador caía num fuso fixo em vez do fuso do workspace, e todo bloco de agenda ou data previa a
hora errada fora daquele fuso. Fuso é parâmetro, nunca constante, e fuso inválido (`"BRT"` existe em
dados reais) tem que cair num padrão em vez de quebrar:

```js
try { fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }); }
catch { fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: '2-digit', hour12: false }); }
```

A hora `"24"` aparece à meia-noite em alguns runtimes: use `% 24`.

### 8.10 Regressão por escrever campo não configurado

O controlador de chat em "atendimento" gravava fila e responsável **mesmo quando a config não os
tinha**, zerando a fila de conversas já em atendimento em fluxos publicados. Só escreva o campo que
a config realmente traz. Config legada sem o campo não quer dizer "apague o valor".

### 8.11 Importador que derrubava a importação inteira

Um fuso não-IANA num nó fazia a importação de 40 nós falhar inteira. Conversor de dado externo trata
cada item isoladamente, e o item problemático vira pendência no relatório.

### 8.12 Varredura de pureza vazia

Tínhamos um teste garantindo que o domínio puro não faz I/O, e ele não cobria dois arquivos novos e
a checagem de relógio era vazia. **Plantamos um `fetch()` de propósito** para confirmar que o teste
pegava. Teste de "não existe X" precisa ser verificado plantando X.

### 8.13 Sessão vazando contra o limite

Sessões de simulação tinham teto por usuário e vazavam ao recarregar a página, respondendo 429 para
quem não tinha culpa. Para recurso efêmero, **o servidor evita o mais antigo** em vez de recusar o
novo.

### 8.14 Salto de fluxo em laço

Fluxo A salta para B, B salta para A: laço infinito criando execuções. O contador de profundidade
viaja no contexto (`_runtime.jumpDepth`) e o teto é 10. Qualquer bloco que inicie outro fluxo
precisa de um contador assim, no contexto e não na memória do processo.

### 8.15 Número bloqueado por rajada

No disparo em massa, intervalo fixo e sem teto diário é o caminho curto para o número ser bloqueado.
O que aplicamos: intervalo **sorteado** entre mínimo e máximo, piso de 20 s que a API recusa baixar,
cota por janela de 24 h, e opt-in como regra e não opção. E a checagem de "pediu para sair" é
**refeita no momento do envio**, porque o pedido pode chegar depois do disparo ser criado.

---

## 9. Realidades do WhatsApp não oficial

Usamos Baileys. O que vale saber antes de começar:

- **A sessão pertence a um worker.** O socket vive na memória de um processo. Com várias instâncias,
  decida quem é o dono do canal e trate "sessão indisponível" como erro retentável, não como falha
  definitiva.
- **Sticker tem que ser WebP.** Verifique o arquivo antes de enviar; o cliente recusa em silêncio.
- **Apagar mensagem tem janela.** Precisa de `remoteJid`, `fromMe: true` e o id externo. Janela
  expirada é falha definitiva: marque e pare, não fique retentando.
- **Botão interativo é instável.** Trate sempre a resposta digitada como alternativa: o contato
  responde com o texto da opção ou com o número dela. Nossa resolução de escolha aceita os três
  (id, rótulo, número).
- **Guarde o id externo de toda mensagem enviada.** Sem ele não há reação, resposta citada nem
  exclusão depois.
- **Presença "digitando"** antes do envio é o que faz a conversa não parecer robô. Aplicada por
  item, não por bloco.

---

## 10. Validação: erro versus aviso

Duas categorias, e a diferença importa muito para a experiência:

**Erro** (bloqueia publicar): saída de menu sem rota ou com rota duplicada, rota de IA inválida,
saída de distribuidor sem destino, porta inválida ou duplicada, destino de salto ausente ou
inexistente, desfecho sem tipo, atribuição sem alvo, agente ausente.

**Aviso** (publica mesmo assim): bloco sem saída (`MISSING_OUTPUT`), condicional sem um dos caminhos
(`CONDITION_ENDS_FLOW`), destino de salto **arquivado**.

A regra que extraímos: **erro é o que vai quebrar em execução; aviso é escolha de desenho.** Quando
em dúvida, aviso — erro que bloqueia publicação de fluxo que já funcionava é a pior falha de
produto que cometemos.

---

## 11. Simulador

Vale construir, e vale construir do jeito certo: um **motor puro separado**, que recebe
`(estado, entrada)` e devolve novo estado, sem banco, sem fila, sem rede.

- Entradas: `start`, `reply`, `choice`, `advance`, `port`.
- Estado inteiramente serializável em JSON, para caber numa sessão efêmera.
- Tetos (200 passos, 100 mensagens) que resultam em **erro**, não em laço.
- Ele importa a mesma seleção de aresta e a mesma interpolação do motor real. Se duplicar, divergem.
- "Executar de verdade" (chamar IA ou webhook mesmo) exige confirmação explícita **por sessão**, não
  um botão que fica ligado.

---

## 12. Como um fluxo começa

Separe o gatilho do desenho do fluxo. Um fluxo não deve decidir quando ele mesmo começa.

Por conexão de WhatsApp, quatro posições e uma lista de palavras-chave:

| Posição | Quando |
|---|---|
| Boas-vindas | primeira mensagem do contato naquela conexão |
| Resposta padrão | contato escreve e nenhuma execução rodou dentro da janela (24 h por padrão) |
| Conversa finalizada | conversa é resolvida |
| Atendimento finalizado | atendente encerra |

**Ordem de decisão na mensagem recebida** — nessa ordem, e ela é o que evita começar fluxo em cima
de fluxo:

```
1. existe execução esperando resposta? → retoma, e NÃO inicia nada
2. a mensagem casa com palavra-chave?  → inicia o fluxo dela
3. é a primeira mensagem do contato?   → Boas-vindas
4. nenhuma execução na janela?         → Resposta padrão
5. nada                                 → não faz nada
```

Palavra-chave casa por texto normalizado (minúsculas, espaços colapsados), com `EXACT` antes de
`CONTAINS` e, no empate, a palavra mais longa primeiro. Sem essa ordenação, uma palavra curta
engole as específicas.

---

## 13. Ordem de construção recomendada

A ordem importa: cada etapa é testável sozinha e as seguintes dependem dela.

1. **Contratos**: schema do fluxo e de 3 blocos (mensagem, condicional, espera). Nada mais.
2. **Domínio puro**: seleção de aresta e interpolação, com testes. Aqui mora a lógica difícil.
3. **Motor com um nó só**: mensagem. Com outbox e idempotência desde o primeiro dia — enxertar
   idempotência depois é refatoração grande.
4. **Esperas**: `delay` e `wait_response`, com a confirmação de retomada da seção 4.
5. **Condicional e menu**: as duas únicas ramificações de verdade.
6. **Editor**: canvas, modais com Cancelar/Salvar, aviso de alteração não salva.
7. **Validação**: erro versus aviso.
8. **Simulador**, reusando o domínio puro.
9. **Os outros blocos**, um por vez. Nenhum deles é estrutural.

Duas coisas para fazer no dia 1, não depois: **idempotência de job** e **um ponto único de escrita
no contexto**. As duas são caras de enxertar e as duas causaram os piores bugs aqui.

---

## 14. O que não copiar de nós

Em nome da honestidade, para não propagar erro:

- **Nossa densidade de código.** O editor é um arquivo de mais de mil linhas em JSX de linha única.
  Funciona e é consistente com o resto do projeto, mas não é um padrão a imitar.
- **A ausência de teste de interface.** O pacote web não tem ambiente de DOM, então nada do editor
  ou do simulador tem teste automatizado. Toda a confiança vem de tipos e de revisão.
- **`providerPayload` como saco de propriedades.** Carregamos `typingSeconds`, `sequence`,
  `quotedMessageId`, `deleteOnTagId` e o tipo de mídia todos no mesmo JSON da mensagem. Funciona,
  mas colunas ou uma tabela de intenção de envio seriam mais claras.
- **O bloco `handoff` chamado assim.** O nome na interface é "Controlador de Chat" desde a paridade
  com o Leona, mas o `kind` continua `handoff` em todo lugar. Nomeie certo desde o começo.
