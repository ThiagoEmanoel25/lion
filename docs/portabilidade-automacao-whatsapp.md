# Automação de WhatsApp e construtor de fluxos: o que levar para outra ferramenta

Escrito para quem vai reconstruir este sistema em outra base de código. Não é um tutorial do Nexo:
é o conjunto de decisões, contratos e armadilhas que custaram caro para descobrir aqui, para que a
próxima construção não pague de novo.

Leia a seção **Armadilhas** antes de escrever qualquer linha. Metade dos erros listados lá passou por
revisão de código e só apareceu em teste de mutação ou em produção.

---

## 1. A decisão central: o fluxo é dado, não código

Um fluxo é um **JSON versionado**, interpretado por um motor. Não é código gerado, não é uma máquina
de estados compilada, não é uma classe por bloco.

```
definition = {
  start: "<id do nó inicial>",
  nodes: [{ id, kind, name, config, position: {x,y} }],
  edges: [{ id, source, target, label?, condition?, isDefault?, priority, port? }],
  settings: { maxSteps, timeoutSeconds }
}
```

Consequências que você herda ao aceitar isso, e que são o motivo de ele ser a escolha certa:

- **Publicar é congelar.** Cada publicação cria uma versão imutável (`version`, `definition`,
  `checksum`). Uma execução guarda o id da versão, não o do fluxo. Editar um fluxo com mil conversas
  rodando não muda o caminho de nenhuma delas. Sem isso, toda edição é um incidente.
- **O editor nunca fala com o motor.** O editor produz JSON; o motor consome JSON. As duas pontas só
  compartilham o esquema.
- **Migração de formato é inevitável.** Fluxos salvos há seis meses têm campos que não existem mais.
  Todo leitor de `config` precisa tolerar o formato antigo (ver armadilha 12).

---

## 2. Arquitetura mínima

Quatro peças. Menos que isso e você vai juntar responsabilidades que precisam escalar separado.

| Peça | Responsabilidade | O que **não** pode estar aqui |
|---|---|---|
| **API** | CRUD de fluxos, validação, publicação, versões | Enviar mensagem, rodar fluxo |
| **Runtime** | Motor de execução, filas, sessão do WhatsApp | Regra de validação de fluxo |
| **Domínio (pacote puro)** | Seleção de aresta, interpolação, condições, cálculos de tempo | I/O, banco, `fetch`, `Date.now()` escondido |
| **Web** | Editor de canvas e telas | Lógica de execução duplicada |

### A regra que salva o domínio

O pacote de domínio é **puro e testado sem banco**. Toda a lógica que decide *o que acontece* mora
lá e é usada **pelo motor real e pelo simulador**. Se o simulador tiver a sua própria cópia da
seleção de aresta, as duas divergem em semanas e o simulador passa a mentir.

Mantenha um teste de pureza automatizado que falha se alguém importar `fetch`, cliente de banco ou ler
o relógio dentro do pacote. O nosso teve um furo (armadilha 10) e deixou passar exatamente isso.

### A regra do pacote de contratos

O front importa **só tipos** do pacote de contratos, nunca valores. Constante que o front precisa é
espelhada localmente. Motivo: o pacote de contratos carrega zod e dependências de servidor; importar
um valor arrasta a árvore inteira para o bundle do navegador. É uma regra chata e não negociável —
coloque no lint, não na revisão humana.

---

## 3. Modelo de dados

O essencial, sem o que não dá para funcionar:

| Tabela | Por que existe |
|---|---|
| `Workspace` | Tenant. **Toda** consulta filtra por ele (ver armadilha 1) |
| `Channel` | Um número de WhatsApp conectado, com estado da sessão |
| `Contact` | Pessoa. `consentAt` para opt-in, `optedOutAt` para lista de saída |
| `Conversation` | Thread por (contato, canal), com `status` e `mode` (IA ou humano) |
| `Message` | Cada mensagem, com `externalId` do WhatsApp e `status` de entrega |
| `Playbook` | O fluxo. Aponta para a versão ativa |
| `PlaybookVersion` | `version`, `definition` (JSON), `checksum`, `publishedAt`. Único por (fluxo, versão) |
| `Execution` | Uma corrida do fluxo: `status`, `currentNode`, `context` (JSON) |
| `ExecutionStep` | Cada passo: `nodeId`, `kind`, `status`, `input`, `output`, `reason`, `durationMs`, `costCents` |
| `OutboxEvent` | **A espinha dorsal.** `type`, `payload`, `availableAt`, `processedAt`, `attempts` |
| `ChannelFlowConfig` | Qual fluxo roda em qual gatilho de qual canal |
| `ChannelKeyword` | Palavra recebida → fluxo |

`ExecutionStep` parece opcional e não é: sem o histórico passo a passo, depurar "por que esse contato
recebeu isso" é impossível. Guarde `input` e `output` de cada passo desde o primeiro dia.

---

## 4. O outbox é a peça que você não deve improvisar

Nada envia mensagem direto. Tudo grava uma linha em `OutboxEvent` **dentro da mesma transação** que
mudou o estado, e um relay entrega.

```
OutboxEvent { workspaceId, aggregate, aggregateId, type, payload, attempts, availableAt, processedAt }
índice: (processedAt, availableAt)
```

O relay roda a cada segundo, pega 50 eventos com `processedAt = null`, `availableAt <= agora` e
`attempts < 10`, e despacha para a fila certa.

Por que isso importa mais do que parece:

- **Atomicidade.** Criar a mensagem e pedir o envio na mesma transação elimina o caso "mensagem no
  banco que nunca sai" e o caso "enviou e não registrou".
- **`availableAt` é agendamento de graça.** Mensagem agendada, espera, disparo em massa espaçado: tudo
  é um evento com `availableAt` no futuro. Não construa uma segunda fila de agendamento — já está aqui.
- **Cancelar é marcar `processedAt`.** Cancelar um agendamento ou pausar um disparo é fechar os eventos
  pendentes. Sem fila paralela, sem job órfão.

Tipos de evento que usamos, como referência de granularidade:

```
message.send.requested          message.delete.requested
scheduled_message.send.requested  broadcast.recipient.requested
notification.send.requested     reaction.send.requested
automation.execution.requested  automation.inbound.received
automation.trigger.requested    automation.channel_slot.requested
automation.sequence.continue.requested
```

### Idempotência: as duas técnicas

Toda retentativa precisa ser inofensiva. Use as duas:

**1. `jobId` fixo e determinístico.** O id do job é derivado do que ele faz, nunca aleatório:

```
outbox-<eventId>
automation-seq-<stepId>-<index>
automation-wait-reply-<stepId>
automation-menu-timeout-<executionId>-<stepId>
automation-resume-<executionId>-<stepId>
```

A fila rejeita o duplicado. Isso é o que impede o motor e o worker de agendarem a mesma continuação
duas vezes — situação real, porque os dois têm motivo para agendar.

**2. Reivindicação condicional.** Para transições que disparam efeito externo, mude o estado com uma
condição e **confie na contagem**:

```sql
UPDATE conversation SET status='RESOLVED' WHERE id=? AND status <> 'RESOLVED'
-- count = 0 → outra corrida já resolveu: não emita o evento
```

Executar duas vezes manda duas mensagens para o cliente. A reivindicação é o que garante "exatamente
uma vez" sem lock distribuído.

---

## 5. Saídas nomeadas (o contrato das conexões)

Uma aresta tem `source`, `target`, `priority`, e opcionalmente `port`, `condition`, `isDefault`.

```
portas possíveis: success | failure | reply | timeout

webhook       → success, failure
ai            → success, failure
pixel         → success, failure
manipulator   → success, failure
wait_response → reply, timeout
```

Arestas salvas antes das portas existirem não têm `port`: **leia ausência como `success`**. Essa única
linha de compatibilidade evitou migrar dados.

### A ordem de seleção da próxima aresta

Exatamente esta, e a ordem importa:

1. Candidatas = arestas cuja origem é o nó, **ordenadas por `priority` crescente**.
2. **Menu com rotas por opção:** primeira candidata cuja condição casa com a escolha; se nenhuma, a
   marcada como `isDefault`.
3. **Condicional:** avalia as regras com `logic` (`all` ou `any`). Casou → primeira aresta **não**
   default. Não casou → a aresta default.
4. **Outros nós:** primeira candidata cuja condição casa, senão a default, senão a primeira.

### A regra de produto que simplifica tudo

**Um caminho sem conexão encerra o fluxo.** Não é erro de validação, não bloqueia publicação, não é
exceção em tempo de execução. O contato simplesmente para ali.

Adotamos isso porque o concorrente faz assim e porque a alternativa — exigir que todo caminho termine
em um nó terminal — bloqueava a publicação de fluxos legítimos importados. Vire erros de "falta saída"
em **avisos**. Isso destravou metade dos fluxos importados.

---

## 6. O motor: laço, estados e as três esperas

O laço é simples: carrega a execução, resolve o nó atual, executa, escolhe a aresta, repete até
terminar, esperar ou estourar `maxSteps`.

O que **não** é simples é a espera. Um fluxo de WhatsApp passa a maior parte da vida parado esperando
gente. Existem três esperas e cada uma precisa do seu próprio estado:

```
_runtime: {
  pendingDelayStepId?: string              // intervalo / agendamento
  pendingWait?: { stepId, nodeId, kind: 'menu' | 'reply', since? }
  pendingSequence?: { stepId, index }      // item N de uma mensagem de vários conteúdos
  quoteNext?, jumpDepth?, error?
}
```

### A regra que evita o bug mais difícil desta categoria

Quando um job de retomada chega, **confira se ele é o job que a execução está esperando**:

```
delayDue    = job.action==='resume'       && pending.pendingDelayStepId === job.resumeStepId
menuDue     = job.action==='menu_reply'   && pendingWait.stepId        === job.resumeStepId
sequenceDue = job.action==='sequence_next'&& pendingSequence.stepId    === job.resumeStepId
                                          && pendingSequence.index     === job.sequenceIndex
```

Sem essa checagem, um job atrasado de uma espera já resolvida retoma a execução de um ponto que não
existe mais, e o contato recebe uma mensagem do meio do fluxo sem contexto. **Retome por `stepId`,
nunca por "o nó atual".**

### Buffer de resposta

Quando o fluxo espera resposta, o contato manda três mensagens em dez segundos. Sem buffer, o fluxo
processa a primeira e ignora as outras duas, ou pior, roda três vezes.

Solução: uma janela de buffer (máximo 300 s no nosso caso) com `jobId` fixo por `stepId`. Mensagens
dentro da janela são deduplicadas pelo job, e quando ele roda, lê **todas** as mensagens da janela e
junta os corpos com `\n` numa única `last_message`. O tipo é o da última mensagem.

### Limites que você precisa ter desde o início

```
maxSteps por execução           (padrão 30)   → erro MAX_STEPS_EXCEEDED
conteúdos por bloco de mensagem 30
"digitando"                     3 a 60 s
pausa entre conteúdos           até 300 s
espera por resposta             até 2.678.400 s (31 dias)
buffer de resposta              até 300 s
profundidade de salto de fluxo  jumpDepth, para fluxo que chama fluxo em ciclo
```

Um fluxo com ciclo e sem `maxSteps` roda para sempre e consome a conta de IA inteira. O limite não é
refinamento, é contenção de incêndio.

---

## 7. Catálogo de blocos

22 tipos. A coluna de saídas é o que importa para o motor.

| Bloco | O que faz | Saídas |
|---|---|---|
| `trigger` | Ponto de entrada. Não tem editor próprio: o gatilho mora na configuração do canal | 1 |
| `message` | Vários conteúdos em sequência: texto, mídia, arquivo, contato (vCard), sticker, pausa | 1 |
| `image` `audio` `sticker` | Mídia avulsa | 1 |
| `buttons` | Menu de opções (até 3 botões ou 10 itens de lista) | 1 por opção + inatividade |
| `wait_response` | Espera o contato responder, com buffer e salvamento da resposta | `reply`, `timeout` |
| `ai` | Chama o modelo, roteia por classificação, lê comprovante | `success`, `failure` + 1 por rota |
| `agent` | Entrega a conversa a um agente de IA com base de conhecimento | 1 |
| `condition` | Regras sobre o contexto, com `all` ou `any` | casou / não casou |
| `delay` | Intervalo fixo, data específica ou faixa de horários por dia da semana | 1 |
| `webhook` | HTTP para fora, grava a resposta no contexto | `success`, `failure` |
| `assign` | Departamento e responsável, resolvidos no momento da execução | 1 |
| `tag` | Adiciona ou remove etiquetas | 1 |
| `manipulator` | Define, soma, subtrai, multiplica ou divide um campo | `success`, `failure` |
| `handoff` | Controlador de chat: Aguardando, Atendimento, Resolvido | 1 (opcional) |
| `kanban` | Cria ou move cartão | 1 |
| `flow_jump` | Salta para outro fluxo | 0 |
| `distributor` | Divide contatos entre saídas por peso, com contagem persistida | 1 por saída |
| `notification` | Avisa a equipe pelo próprio canal | 1 |
| `pixel` | Evento de conversão para o Facebook | `success`, `failure` |
| `outcome` | Registra o desfecho (qualificado, venda, agendamento…) | 0 |

### Blocos cujo detalhe some na reconstrução

- **`message` é uma sequência, não uma mensagem.** Um bloco manda N conteúdos com pausas entre eles.
  Isso obriga a terceira espera (`pendingSequence`) e é a razão de a entrega ser por item, não por
  bloco. Se você modelar "um bloco = uma mensagem", vai refazer depois.
- **`buttons` tem dois comportamentos.** Com as saídas ligadas por opção, ele **espera** a escolha.
  Com uma saída única, ele manda e segue. O segundo caso existe por causa de fluxos antigos; decida
  explicitamente se você quer manter.
- **Escolha de menu precisa de três formas de casar.** O contato toca no botão (vem o id), digita o
  texto do botão, ou digita o número da opção. Clientes de WhatsApp sem suporte interativo só
  permitem os dois últimos. Implementar só o id quebra para parte da base.
- **`distributor` precisa de contador persistido**, senão o rateio reinicia a cada deploy.

---

## 8. Gatilhos: onde o fluxo começa

Decisão importante: **o gatilho não mora no fluxo, mora no canal.** Cada canal tem quatro encaixes:

```
WELCOME               primeira mensagem do contato
DEFAULT_RESPONSE      contato escreve e nenhum fluxo está rodando, com janela em horas (padrão 24)
CONVERSATION_RESOLVED conversa finalizada
HANDOFF_CLOSED        atendimento finalizado
```

Mais **palavras-chave** por canal: palavra recebida → fluxo, com casamento `EXACT` ou `CONTAINS`.

### A ordem de roteamento de uma mensagem recebida

Exatamente esta:

1. Execução esperando resposta? **Retoma** — e para aqui. Nunca inicie um fluxo novo com a mensagem
   que respondeu a uma espera. (Esse foi um bug real: o contato respondia e recebia, ao mesmo tempo,
   a continuação do fluxo e as boas-vindas de novo.)
2. Casa com palavra-chave? Inicia o fluxo dela. **`EXACT` antes de `CONTAINS`**, e entre dois
   `CONTAINS`, a palavra mais longa ganha — senão "pix" rouba "pixel".
3. É a primeira mensagem do contato naquele canal? Inicia o de boas-vindas.
4. Nenhuma execução rodou dentro da janela? Inicia a resposta padrão.
5. Nada.

Os eventos internos de gatilho (`message.received`, `tag.added`, `conversation.created`) continuam
existindo para fluxo disparado por etiqueta, com `oncePerContact` para não repetir.

---

## 9. Contexto, variáveis e interpolação

O contexto da execução é um JSON que cresce conforme o fluxo anda:

```
contact: { name, firstName, phone, email, stage, customFields, tags, tagIds }
conversation: { status, mode, queue, assigneeId, window24h }
system: { weekday, time, date }      ← no fuso do workspace
global: { ... }                      ← variáveis globais do workspace
last_message, last_message_type
ai: { response, route, receiptValid }
comprovante: { valor, nome_pagador, data, referencia }
_runtime: { ... }                    ← estado do motor, nunca exposto ao usuário
```

Interpolação: `{{ caminho.com.ponto }}`. Valor ausente vira **string vazia**, objeto vira JSON.

### Duas regras não óbvias

**1. Condições leem o estado de agora, não o do início.** Quando a execução pausa 3 dias num
intervalo, o contato pode ter ganhado etiqueta, mudado de etapa, sido atribuído. Reconstrua a parte
"viva" do contexto (contato, conversa, relógio) **no momento de avaliar**, e mescle sobre o contexto
guardado. Avaliar condição com o retrato de três dias atrás dá a resposta errada sem nenhum sinal.

**2. Mensagem que ficou vazia é erro, não mensagem vazia.** Se `{{nome}}` não existe e o texto era só
isso, o resultado é `""`. Enviar string vazia pelo WhatsApp falha de forma obscura. Falhe explícito
(`EMPTY_MESSAGE`) e mande pela saída de erro. **E faça o simulador falhar igual** (armadilha 7).

---

## 10. Validação: erro versus aviso

Duas classes, e a diferença é operacional:

- **Erro bloqueia publicação.** Reserve para o que torna o fluxo impossível: nó inicial inexistente,
  aresta apontando para nó que não existe, config que não passa no esquema, ciclo sem saída.
- **Aviso não bloqueia.** Caminho sem conexão, nó inalcançável, fluxo de destino arquivado.

Erre para o lado do aviso. Cada erro a mais é um fluxo importado que o cliente não consegue publicar,
e ele não vai entender por quê.

Códigos que valem copiar como checklist de validação: nó inicial ausente ou não-gatilho, ids
duplicados de nó e de aresta, aresta com origem ou destino inexistente, auto-laço, ciclo, nó sem
entrada, nó inalcançável, porta inválida para o tipo do nó, duas arestas na mesma porta, opção de
menu sem rota, rota de menu para opção que não existe, prioridade duplicada em ramos, nó terminal com
saída, e um por tipo para config inválida.

### A armadilha de salvar

Se a validação roda no salvamento **e** o salvamento rejeita qualquer erro, um fluxo pode se tornar
insalvável por causa de uma mudança em **outro** fluxo. Aconteceu aqui: arquivar o fluxo B fez o
fluxo A, que saltava para B, virar insalvável — e quem estava editando A perdeu o trabalho (armadilha 4).

**Regra: nada que aconteça fora de um fluxo pode impedir que ele seja salvo.**

---

## 11. Simulador

Vale muito e é mais barato do que parece, **se** o motor de simulação for o mesmo código puro do motor
real. Um simulador separado mente.

Forma que funcionou: função pura `stepSimulation(state, input)` com `input` sendo
`start | reply | choice | advance | port`, estado serializável em JSON, limites de 200 passos e 100
mensagens. Sessões efêmeras no servidor, teto por usuário com descarte do mais antigo (não erro 429).

Três coisas que o simulador precisa recusar exatamente como a produção: mensagem vazia por variável
ausente, fuso do workspace nos cálculos de data, e chamada externa de verdade só com confirmação
explícita.

---

## 12. Armadilhas

Esta é a parte que justifica o documento. Cada item aconteceu, passou por revisão, e custou tempo.

### 1. Poluição de protótipo no gravador de contexto

A função que escreve `contexto.caminho = valor` aceitava `__proto__.x` e envenenava
`Object.prototype` **do processo inteiro, para todos os workspaces**. A entrada vinha de webhook, de
resposta de IA e do manipulador — três portas para o mesmo lugar.

Conserto: barrar `__proto__`, `constructor` e `prototype` **no sumidouro compartilhado**, não em cada
chamador. Um dos chamadores sempre escapa.

### 2. Uma barra invertida que não existia

O escape de ponto e vírgula do vCard estava escrito `'\;'` em JavaScript. Isso **é** `';'` — a barra
some. O código não escapava nada.

O que fez isso sobreviver: **o teste usava o mesmo literal quebrado na expectativa**, então passava
com e sem o bug. Em testes de escape, escreva a expectativa com string literal crua e nunca com a
mesma construção que o código usa.

### 3. Seletor de CSS que nunca casava

A biblioteca de canvas coloca a classe no nó-contêiner dela, não no elemento interno. O destaque do
nó em execução no simulador — a função principal da entrega — era invisível. O padrão correto já
existia três linhas acima no mesmo arquivo, para outro estado.

Lição: se a entrega é visual, **alguém precisa abrir no navegador**. Nenhum teste nosso pegaria isso.

### 4. Um fluxo arquivado deixando outro insalvável

Ver seção 10. Erro de nível alto em condição externa ao fluxo.

### 5. O fuso errado no simulador

O simulador caía num fuso fixo em vez do fuso do workspace. Todo cálculo de agendamento e de data
previa horário diferente da produção para quem não estava naquele fuso. Passe o fuso explicitamente;
nunca tenha um padrão plausível (foi justamente o padrão plausível que escondeu o bug).

### 6. Regressão por escrever campo não configurado

O bloco que coloca a conversa em atendimento passou a **limpar** fila e responsável em fluxos já
publicados que não configuravam esses campos. Escreva só o que foi configurado:

```js
{ ...(queue ? { queue } : {}), ...(assigneeId ? { assigneeId } : {}) }
```

### 7. O simulador sendo mais tolerante que a produção

Onde a produção lança `EMPTY_MESSAGE`, o simulador seguia feliz. O usuário testava, funcionava, e
quebrava no cliente. **Toda divergência de rigor entre simulador e produção é um bug do simulador.**

### 8. Importador casando por substring

Ao importar fluxos de outra ferramenta, o estado `"unresolved"` casou como `RESOLVED` por conter a
palavra. Ancore comparações de enum; o que não reconhecer deve cair num padrão seguro **e gerar
pendência visível**, nunca um palpite silencioso.

### 9. Importador derrubando a importação inteira

Um fuso não-IANA (`BRT`) num fluxo de cinquenta jogava exceção e perdia tudo. Toda conversão de dado
externo entra em `try/catch` que termina em pendência, não em exceção.

### 10. Teste de pureza vazio

O teste que garantia que o pacote de domínio não faz I/O não cobria dois arquivos novos, e a
verificação de leitura de relógio era vacuamente verdadeira. Confirmei plantando `fetch()` dentro do
pacote: o teste passou.

**Teste de garantia precisa ser testado por mutação.** Plante o problema e veja o teste falhar.
Fizemos isso em todo guarda crítico deste sistema e encontramos dois testes inúteis.

### 11. Campo preenchido com string vazia em silêncio

O importador, quando não conseguia adivinhar a chave do valor, gravava `''` no campo do contato.
Vazio é um valor; ele passa por validação e estraga o dado. Prefira pendência a palpite.

### 12. Config antiga que não existe mais

Depois de mudar fila de texto livre para id de cadastro, fluxos antigos continuam tendo o texto. O
leitor precisa aceitar os dois, preferir o novo, e a interface precisa mostrar o legado como
pendência em vez de apagá-lo. O mesmo vale para aresta sem `port`.

### 13. Validação faltando no caminho menos usado

O sticker avulso não era validado como WebP, só o sticker dentro da sequência de mensagem. O caminho
"avulso" de cada tipo de conteúdo esquece a validação do caminho principal. Liste os dois e compare.

### 14. Regra criada antes do envio existir

A regra "apagar esta mensagem quando a etiqueta for aplicada" precisa do id da mensagem no WhatsApp,
que só existe **depois** do envio confirmado. Criar a regra no momento do agendamento gera regra
órfã apontando para mensagem que nunca saiu. Crie efeitos que dependem de id externo no retorno do
envio, não na intenção.

### 15. O teste que não pegava o bug que eu tinha acabado de plantar

No disparo em massa, mutei o guarda de virada de dia e o teste continuou verde. O teste checava se a
agenda era **crescente**; o bug violava o **intervalo mínimo**. Duas propriedades diferentes, e só
uma importava para o risco real (bloqueio do número).

Escreva o teste contra a propriedade que você precisa garantir, não contra uma consequência dela.

### 16. Multi-tenant: o filtro que não pode faltar

Toda consulta filtra por workspace, incluindo as de dentro de transação e as que buscam por id
primário. Buscar por id "porque id é único" é a forma mais comum de vazar dado entre clientes: o id
vem da config do fluxo, que vem do JSON, que pode ter sido importado de qualquer lugar.

---

## 13. WhatsApp não oficial: o que a biblioteca não avisa

- **Sessão é estado, e estado precisa de dono.** Uma sessão aberta em dois processos derruba as duas.
  Decida quem é o dono da sessão de cada canal e falhe claro quando não for você.
- **Enviar em rajada bloqueia o número.** Qualquer envio em volume precisa de intervalo aleatório
  entre mensagens e teto por dia. Piso de 20 segundos entre envios foi o nosso mínimo defensável.
- **Opt-in é regra, não opção.** Só alcance quem registrou consentimento. E quem responde "SAIR",
  "PARAR" e equivalentes sai da lista na hora — compare a **mensagem inteira**, não por pedaço, senão
  "não pare de mandar novidades" tira a pessoa da lista. Reconfira a saída **no momento do envio**: o
  pedido pode chegar depois de o disparo ser criado.
- **Apagar mensagem tem janela.** Expirou, não volta. Marque a falha como definitiva em vez de
  retentar para sempre.
- **"Digitando" é presença, não atraso.** São duas chamadas distintas, e a presença precisa ser
  encerrada depois.

---

## 14. Ordem de construção recomendada

Nesta ordem, cada etapa é testável sozinha e nenhuma trava a seguinte:

1. **Esquema do fluxo + versionamento + validação.** Sem motor. Só salvar, validar, publicar, versão
   imutável.
2. **Outbox + relay + fila.** Com um tipo de evento só (enviar mensagem). É a fundação.
3. **Motor com três blocos:** gatilho, mensagem de texto, condicional. Prova o laço, a seleção de
   aresta e o contexto.
4. **As três esperas**, uma por vez: intervalo, espera por resposta, sequência de conteúdos. Cada uma
   com seu teste de retomada por `stepId` e de job duplicado.
5. **Gatilhos por canal** (os quatro encaixes + palavras-chave) com a ordem de roteamento da seção 8.
6. **O resto dos blocos**, em qualquer ordem. A partir daqui é repetição de um padrão.
7. **Simulador**, reusando o domínio puro.
8. **Editor de canvas.** Deliberadamente por último: é a parte mais visível e a que menos decide
   arquitetura. Construir primeiro gera um editor que luta contra o motor.

---

## 15. O que eu repensaria

- **Flexibilidade de config por bloco cobrou caro.** Aceitar nomes alternativos de campo "para
  compatibilidade" multiplicou os caminhos de leitura. Um esquema estrito por versão de bloco, com
  migração explícita na publicação, teria sido mais barato.
- **O nó de IA faz coisas demais:** responde, classifica rota, lê comprovante, transcreve áudio.
  Deveriam ser blocos separados compartilhando uma chamada.
- **Erro versus aviso deveria ter uma terceira classe:** "pendência de dado", para o que veio de
  importação e precisa de decisão humana. Empurrar isso para "aviso" mistura coisas de natureza
  diferente na mesma lista.
- **Decidir o fuso por workspace, não por canal,** foi certo, mas devia ter sido parâmetro
  obrigatório em toda função de tempo desde o início. Padrão plausível esconde bug (armadilha 5).
