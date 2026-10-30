# Porte da automação de WhatsApp e do construtor de fluxos

Guia para reconstruir, em outra base de código, o que o Nexo tem hoje: o construtor de fluxos
visual e o motor que executa esses fluxos sobre WhatsApp não oficial (Baileys).

**Para quem escrevi:** quem vai implementar isso em outra ferramenta, sem acesso a este
repositório e sem conhecer as decisões que foram tomadas aqui.

O documento não é um tutorial de framework. Ele descreve **o modelo**, os **contratos de dados** e,
principalmente, as **armadilhas** — cada uma delas custou um bug real aqui. A seção
[12. Armadilhas](#12-armadilhas-que-já-custaram-bug) é a parte que mais reduz retrabalho; se você só
ler uma seção, leia aquela.

Referência de tecnologia atual (só para contexto, nada aqui exige isso): Node 22, TypeScript,
Fastify + Prisma + Postgres na API, NestJS + BullMQ + Redis no runtime, React + React Flow no editor,
Zod para esquemas, Baileys para WhatsApp.

---

## 1. Separação em quatro pedaços

A divisão abaixo não é estética: cada fronteira existe porque atravessá-la causou problema.

| Pedaço | Responsabilidade | Nunca faz |
|---|---|---|
| **API** | CRUD de fluxos, versionamento, validação, autenticação, multi-tenant | Não fala com o WhatsApp nem executa fluxo |
| **Runtime** | Executa fluxos, mantém as sessões de WhatsApp, consome filas | Não serve HTTP para o usuário final |
| **Web** | Editor visual e telas de operação | Não contém regra de negócio |
| **Domain** (pacote puro) | Regras sem I/O: avaliação de condição, seleção de aresta, interpolação, agenda, cálculos | Não importa banco, rede, nem relógio implícito |

**A regra que mais importa:** tudo que é *decisão de fluxo* vive no pacote puro e é importado tanto
pelo runtime real quanto pelo simulador. Se a decisão viver dentro do motor, o simulador vai divergir
do comportamento real e o cliente vai testar uma coisa e receber outra. Aqui isso aconteceu e a
correção foi mover as funções para o pacote puro.

**Fronteira do editor:** o editor importa do pacote de contratos **só tipos, nunca valores**. Constantes
que o editor precisa (rótulos, limites, catálogos) são espelhadas localmente com um comentário dizendo
de onde vieram. Motivo: o pacote de contratos carrega Zod e dependências de servidor; importar valor
ali infla o bundle e, pior, arrasta código de servidor para o navegador.

---

## 2. O formato do fluxo

Um fluxo é um JSON versionado. É o contrato central: se você acertar só isso, tudo o resto é
substituível.

```jsonc
{
  "start": "trigger-1",                  // id do nó inicial, obrigatório, precisa ser kind=trigger
  "nodes": [
    {
      "id": "trigger-1",                 // 1..80 chars, único no fluxo
      "kind": "trigger",                 // enum fechado, ver seção 5
      "name": "Início",                  // 1..120 chars, é o rótulo no canvas
      "config": { },                     // objeto livre; o esquema real depende do kind
      "position": { "x": 100, "y": 180 } // só para o canvas; o motor ignora
    }
  ],
  "edges": [
    {
      "id": "e1",
      "source": "trigger-1",
      "target": "msg-1",
      "label": "opcional",
      "condition": { "field": "contact.stage", "operator": "equals", "value": "new" },
      "isDefault": false,                // a saída "caso contrário"
      "priority": 0,                     // menor número é avaliado primeiro
      "port": "success"                  // saída nomeada; ausente significa "success"
    }
  ],
  "settings": { "maxSteps": 30, "timeoutSeconds": 300 }
}
```

**Limites que valem copiar:** 100 nós, 200 arestas, `maxSteps` de 1 a 100, `timeoutSeconds` de 5 a
3600. `maxSteps` não é decoração — é o que impede um ciclo de rodar para sempre (seção 4).

**Versionamento:** cada salvamento cria uma nova versão imutável com um checksum, e o fluxo aponta
para a versão ativa. Uma execução guarda o **id da versão**, não o id do fluxo. Consequência
importante: publicar uma versão nova **não** muda o comportamento de execuções que já estão rodando.
Isso evita que um contato no meio de um funil caia num fluxo diferente.

**Salvamento com versão esperada:** o cliente manda `expectedVersion` e a API recusa se não bater.
Sem isso, duas abas abertas sobrescrevem uma à outra em silêncio.

---

## 3. Como um fluxo começa

Essa parte decide a sensação do produto e quase sempre é subestimada. Duas abordagens coexistem aqui,
e a segunda é a que os usuários esperam:

**a) Gatilho dentro do fluxo.** O nó inicial declara o evento: `message.received`,
`conversation.created`, `tag.added` (com etiqueta opcional), além de `oncePerContact`.

**b) Configuração por conexão (recomendada).** Cada número de WhatsApp tem quatro encaixes e uma
lista de palavras-chave:

| Encaixe | Quando roda |
|---|---|
| Boas-vindas | Primeira mensagem do contato naquele número |
| Resposta padrão | Contato escreve e nenhuma execução rodou dentro da janela (padrão 24 h) |
| Conversa finalizada | Quando a conversa é finalizada |
| Atendimento finalizado | Quando o atendente encerra |
| Palavras-chave | Uma palavra recebida inicia um fluxo específico |

**A ordem de decisão para cada mensagem recebida importa e é esta:**

1. Existe execução esperando resposta? → **retoma a execução** (nunca inicia outra).
2. A mensagem bate com palavra-chave? → inicia o fluxo da palavra.
3. É a primeira mensagem desse contato no canal? → inicia Boas-vindas.
4. Nenhuma execução rodou dentro da janela? → inicia Resposta padrão.
5. Nada disso → não faz nada.

O passo 1 antes de tudo é obrigatório. Sem ele, a resposta do contato a uma pergunta do fluxo inicia
um fluxo novo em paralelo e o contato recebe duas conversas ao mesmo tempo.

**Desempate de palavra-chave:** correspondência exata ganha de "contém"; entre duas do tipo "contém",
ganha a palavra mais longa. A comparação é feita sobre o texto normalizado (minúsculas, espaços
colapsados, locale pt-BR).

---

## 4. O motor de execução

### Estado persistido

| Tabela | Papel |
|---|---|
| `Execution` | Uma execução: workspace, conversa, id da versão do fluxo, status, `currentNode`, `context` (JSON) |
| `ExecutionStep` | Um passo: nó, kind, status, entrada, saída, motivo da falha, duração, custo |

Status da execução: `RUNNING`, `WAITING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.

### O laço

```
trava distribuída (Redis SET NX com TTL e token) por execução
  carrega execução; se já terminou, sai
  se WAITING: confere se o job que chegou corresponde à espera pendente; se não, descarta
  valida o JSON do fluxo (recusa definição inválida com erro claro)
  currentNode = execution.currentNode ?? definition.start
  enquanto currentNode:
    se passos executados >= maxSteps → falha MAX_STEPS_EXCEEDED
    relê a execução (pode ter sido cancelada por fora) e recarrega o contexto
    escolhe a aresta de saída (seção 4.3)
    cria ou reaproveita o passo RUNNING daquele nó
    executa o nó
      'waiting'  → sai do laço e devolve o controle (o nó agendou a retomada)
      'terminal' → sai do laço, execução concluída
      {next}     → o nó redirecionou o fluxo
    currentNode = próximo
  sem próximo → execução SUCCEEDED
libera a trava (comparando o token, com script Lua)
```

**A trava precisa ser por execução, com token.** Liberar sem comparar o token deixa um processo
liberar a trava de outro depois de uma pausa longa de GC. O TTL (120 s aqui) impede que um processo
morto deixe a execução travada para sempre.

**Releitura do contexto dentro do laço:** sem isso, uma mensagem recebida durante um passo longo
atualiza o contexto no banco e a atualização é descartada no passo seguinte.

### 4.1 Esperas e retomada

Três tipos de pausa, cada um com um marcador próprio no contexto, sob uma chave reservada `_runtime`:

| Marcador | Significa | Retomado por |
|---|---|---|
| `pendingWait` | Esperando resposta do contato (ou escolha de menu) | Mensagem recebida, ou job de tempo esgotado |
| `pendingDelayStepId` | Esperando um intervalo | Job agendado |
| `pendingSequence` | Enviando uma sequência de mensagens, item por item | Confirmação de envio ou fim da pausa |

**A regra de ouro da retomada:** o job que chega precisa provar que corresponde à espera atual,
comparando o `stepId` (e o índice, no caso da sequência). Um job duplicado, atrasado ou de uma espera
já resolvida é descartado em silêncio. Sem essa checagem, uma retentativa da fila faz o fluxo avançar
duas vezes e o contato recebe a mensagem seguinte em dobro.

**Ids de job fixos e determinísticos.** Cada continuação usa um id derivado do passo e do índice
(`automation-seq-<stepId>-<index>`). A fila trata o id repetido como o mesmo job, então nem o motor nem
o worker de envio conseguem agendar a mesma continuação duas vezes.

### 4.2 Idempotência

Quatro mecanismos, todos necessários:

1. **Id de job determinístico** por continuação (acima).
2. **Checagem de espera pendente** por `stepId` antes de retomar.
3. **Reaproveitamento do passo `RUNNING`** do mesmo nó em vez de criar outro.
4. **Reivindicação condicional** para transições que não podem repetir: um `UPDATE ... WHERE status
   <> 'X'` e, se afetou zero linhas, a transição já aconteceu e nada é emitido. É assim que "conversa
   resolvida" dispara o evento de encerramento exatamente uma vez.

### 4.3 Escolha da saída

Uma função pura recebe o nó, as arestas e o contexto, e devolve a aresta a seguir. A lógica é
diferente por tipo de nó:

- **Condição:** avalia as regras (`logic: all | any`). Se bate, segue a aresta não-padrão; se não bate,
  segue a aresta padrão (`isDefault`).
- **Menu com saídas por opção:** acha a aresta cuja condição corresponde à escolha; se nenhuma, a padrão.
- **Nós com portas nomeadas** (`success`/`failure`/`reply`/`timeout`): o nó escolhe a porta em tempo de
  execução e o motor segue a aresta daquela porta.
- **Todo o resto:** a primeira aresta por ordem de `priority`.

**Sem aresta para o caminho escolhido, o fluxo termina ali, com sucesso.** Essa escolha de projeto vale
copiar: a alternativa (erro ao publicar) obriga o usuário a ligar um bloco final em todo galho e torna
fluxos importados impossíveis de salvar.

### 4.4 Interpolação de variáveis

`{{caminho.com.ponto}}` dentro de qualquer texto. Valor ausente ou nulo vira string vazia; objeto é
serializado em JSON.

**O caso que importa:** se o texto de uma mensagem fica **vazio** depois da interpolação, o envio é
recusado com um erro explícito, em vez de mandar mensagem em branco para o cliente. O simulador precisa
recusar do mesmo jeito — ver armadilha 12.6.

---

## 5. Os blocos

22 tipos. Os nomes são os internos; o rótulo visível pode mudar.

| Kind | O que faz | Portas | Observações de implementação |
|---|---|---|---|
| `trigger` | Nó inicial, define o evento | — | Sem editor quando o gatilho vem da conexão (seção 3) |
| `message` | Sequência de conteúdos: texto, arquivo, mídia, contato (vCard), sticker, pausa | — | Até 30 itens; cada um é uma mensagem separada, enviada em ordem |
| `image` / `audio` / `sticker` | Mídia única | — | Sticker exige WebP, validado **nos bytes** |
| `buttons` | Menu de opções | por opção + `timeout` | Até 3 botões ou 10 itens de lista (limite do WhatsApp) |
| `condition` | Ramifica por regras | — (usa `isDefault`) | Recarrega o estado ao vivo antes de avaliar |
| `delay` | Espera: duração, data marcada, ou faixa de horários | — | Precisa do fuso do workspace |
| `wait_response` | Espera a resposta do contato | `reply`, `timeout` | Pode enviar uma mensagem antes de esperar |
| `ai` | Chama o modelo, roteia por classificação | `success`, `failure` | Ver seção 7 |
| `agent` | Entrega a conversa a um agente de IA configurado | — | |
| `webhook` | Chamada HTTP de saída | `success`, `failure` | Ver seção 8 |
| `manipulator` | Define/soma/subtrai/multiplica/divide um campo | `success`, `failure` | Atualização atômica; ver armadilha 12.1 |
| `assign` | Departamento e responsável | — | Resolver por id no momento da execução |
| `tag` | Adiciona ou remove etiquetas | — | Adicionar etiqueta nova emite evento de gatilho |
| `handoff` | Controlador de chat: Aguardando / Atendimento / Resolvido | — | "Resolvido" emite o encerramento uma única vez |
| `outcome` | Registra desfecho (qualificado, agendamento, venda…) | — | Terminal |
| `kanban` | Cria ou move cartão | — | Modos: criar-ou-mover, só criar, só mover |
| `pixel` | Evento de conversão para o Facebook | `success`, `failure` | |
| `flow_jump` | Salta para outro fluxo | — | Ver seção 6 |
| `distributor` | Divide contatos entre saídas por peso | por saída | Atribuição fica gravada por contato |
| `notification` | Avisa a equipe por WhatsApp | — | Não cria contato no inbox |

**Portas nomeadas:** declare um mapa `kind -> portas`. Uma aresta com porta inexistente no tipo é erro
de validação, e aresta antiga sem porta significa `success` — essa compatibilidade evita migração de
dados.

### Limites de mensagem que vale copiar

- Texto: 4096 caracteres. Legenda: 1024.
- "Digitando": 0 ou de 3 a 60 s (abaixo de 3 s o WhatsApp não mostra, então normalize para 0 ou 3).
- Pausa entre itens: 0 a 300 s, sorteada entre um mínimo e um máximo.
- Espera por resposta: até 31 dias; janela de agrupamento de respostas até 300 s.

### Agrupamento de respostas (detalhe que melhora muito a experiência)

Quando o contato manda três mensagens seguidas ("oi", "quero saber do preço", "é urgente"), o bloco de
espera com janela de agrupamento junta as três em `last_message` separadas por quebra de linha, em vez
de tratar a primeira como a resposta. Guarde os ids das mensagens agrupadas: o bloco de IA seguinte
precisa saber que `last_message` já é o texto juntado, senão ele relê só a última.

---

## 6. Salto entre fluxos

Três decisões, todas importantes:

1. **Profundidade máxima** (10 aqui). O contador vive no contexto, e um valor corrompido ou ausente é
   lido como zero — nunca como "pode pular a checagem".
2. **O fluxo de destino não herda variável nenhuma.** Só o contador de profundidade é carregado. Herdar
   contexto cria dependência invisível entre fluxos.
3. **O destino precisa estar publicado.** Pausado, rascunho e arquivado recusam, cada um com erro
   próprio.

Na validação do editor, destino inexistente é **erro**, destino arquivado é **aviso**. A diferença não é
cosmética: ver armadilha 12.3.

---

## 7. Bloco de IA

**Chamada estruturada.** Quando o bloco precisa classificar (escolher uma rota, identificar
comprovante), o pedido ao modelo força JSON e a instrução é anexada ao prompt de sistema:

```jsonc
{"response": "texto para o cliente", "conditionId": null, "receiptValid": false}
```

`response` é o que vai para o contato; `conditionId` só é aceito se estiver na lista de rotas
configuradas; qualquer JSON que não valide vira falha explícita, não texto cru enviado ao cliente.

**A instrução vai no prompt de sistema**, que precisa ser a primeira mensagem. Se o chamador não mandar
mensagem de sistema, a instrução é descartada em silêncio e o modelo responde texto livre — que então
falha a validação. Ou garanta a mensagem de sistema, ou anexe a instrução em outro lugar.

**Leitura estruturada de comprovante:** além do booleano, o modelo devolve os campos lidos
(valor, nome do pagador, data, referência). Normalize tudo e **nunca confie no formato**:

- Valor aceita `R$ 1.234,56` e `1,234.56`. O último separador manda: 1 ou 2 dígitos depois dele é
  decimal, mais que isso é milhar. `1.234` é mil duzentos e trinta e quatro.
- Data sai sempre em `aaaa-mm-dd`, e `31/02` é recusada (`new Date` rolaria para março).
- Campo ilegível fica **nulo, nunca string vazia** — string vazia virou mensagem em branco aqui.
- Os campos só são lidos quando o próprio modelo marcou o comprovante como válido.

**Transcrição de áudio** e **leitura de imagem/PDF** entram como capacidades do bloco, e a busca da
mídia de origem precisa olhar algumas mensagens para trás: um comprovante seguido de "segue aí" ainda
tem que chegar ao modelo como imagem.

---

## 8. Webhook de saída

- Só HTTPS. Sem usuário e senha na URL.
- **Bloqueie endereço privado**: `localhost`, `.local`, `.internal`, faixas 10/8, 127/8, 172.16/12,
  192.168/16, 169.254/16, 100.64/10, IPv6 `::1`, `fc00::/7`, `fe80::/10`, e as mapeadas `::ffff:`.
  Sem isso o bloco vira um scanner da sua rede interna operado pelo cliente (SSRF).
- URL com no máximo 2048 caracteres, tempo limite curto, e a resposta gravada no contexto por um
  caminho configurável.
- A validação no código **não basta**: restrinja a saída do runtime também na rede, porque o DNS é
  resolvido depois.

---

## 9. A camada de WhatsApp (Baileys)

O ponto mais frágil de todo o sistema. O que funcionou aqui:

**Autenticação persistida e cifrada.** As credenciais e as chaves de sessão vão para o banco,
cifradas, serializadas com o serializador do próprio Baileys (ele guarda `Buffer`, que `JSON.stringify`
comum corrompe). Chave de sincronização de estado precisa ser reidratada pelo tipo da biblioteca, não
usada como objeto cru.

**Uma sessão por número, com dono.** Um lease em Redis decide qual processo é o dono do número, e é
renovado periodicamente. Ao perder o lease, o processo encerra o socket imediatamente. Dois processos
com o mesmo número conectado derrubam a sessão em loop.

**Snapshot de sessão efêmero.** O estado "conectado" fica em Redis com TTL renovado enquanto o processo
vive. Assim um runtime que morreu não aparece como conectado para sempre.

**Opções do socket que importam:** não imprimir QR no terminal, `markOnlineOnConnect: false` (ficar
online marca as mensagens como lidas e rouba as notificações do celular do cliente),
`syncFullHistory: false`, e identificação de navegador fixa.

**Desconexão:** trate `loggedOut` como terminal — apaga a credencial e pede novo pareamento. Todo o
resto é reconexão com espera progressiva.

**Deduplicação de entrada.** Grave o evento bruto com uma chave única `canal:idExterno` **antes** de
processar, dentro da mesma transação. O Baileys reentrega mensagem, e sem isso o contato recebe
resposta dupla.

**Id de mensagem determinístico na saída.** Derive o id da mensagem de uma chave de idempotência
(hash, 20 caracteres hexadecimais em maiúsculas). Depois de um erro de rede incerto, a retentativa
usa o mesmo id e o WhatsApp não duplica.

**Telefone:** normalize para E.164 (`+` e só dígitos) a partir do identificador do WhatsApp, que pode
vir com sufixo de dispositivo. Guarde também o identificador original, porque é ele que serve para
responder e para apagar mensagem.

**Mídia:** limite o tamanho antes de baixar, confira pelo cabeçalho e **também** enquanto baixa, em
pedaços. Só o cabeçalho é mentira fácil.

---

## 10. Entrega por caixa de saída (outbox)

Nenhum envio sai direto de dentro de uma transação de negócio. O padrão é:

```
transação:
  cria a mensagem com status PENDING
  cria o evento de caixa de saída  { tipo, agregado, payload, availableAt }
```

Um laço curto (1 s aqui) lê os eventos não processados com `availableAt <= agora` e menos de N
tentativas, e empurra para a fila certa.

**Três ganhos que justificam o padrão:**

1. **Atomicidade.** A mensagem e a ordem de envio nascem juntas ou não nascem.
2. **Agendamento de graça.** `availableAt` no futuro é tudo que precisa para mensagem agendada,
   intervalo, e disparo em massa. Não construa uma segunda fila para isso.
3. **Cancelamento de graça.** Cancelar é marcar os eventos ainda não processados como processados.

Tipos de evento usados aqui: envio de mensagem, exclusão de mensagem, reação, notificação, mensagem
agendada, destinatário de disparo, início de execução, continuação de sequência, mensagem recebida,
gatilho, encaixe de canal, indexação de conhecimento.

**Valide o payload de cada tipo antes de despachar** e marque como processado o evento inválido, senão
um evento malformado trava a fila para sempre.

---

## 11. Validação no editor

A validação roda na API (não só no cliente) e devolve uma lista de problemas com nível, código,
mensagem, e o nó ou aresta culpado — para o editor poder destacar no canvas.

**A distinção que define a usabilidade:** `error` impede publicar; `warning` não impede nada.

| Nível | Exemplos |
|---|---|
| **error** | Nó inicial inexistente ou que não é gatilho; id de nó ou aresta duplicado; origem ou destino de aresta inexistente; porta inválida para o tipo; duas arestas na mesma porta; opção de menu sem rota; rota de IA inválida; alvo de salto inexistente |
| **warning** | Bloco sem saída (o fluxo termina ali); condição sem um dos lados; nó inalcançável; alvo de salto arquivado |

Comece com mais `warning` do que você acha necessário. Toda regra de erro que não é absolutamente
necessária vai, um dia, impedir um cliente de salvar um fluxo que funcionava.

---

## 12. Armadilhas que já custaram bug

Cada item abaixo foi um defeito real. Esta é a parte do documento que paga o tempo de leitura.

### 12.1 Poluição de protótipo pelo caminho das variáveis

A função que grava `contexto.caminho.com.ponto = valor` aceitava `__proto__.algo` e **envenenava
`Object.prototype` do processo inteiro, atravessando workspaces**. Três blocos chegavam nela (webhook,
IA, manipulador).

Bloqueie `__proto__`, `constructor` e `prototype` **na função compartilhada**, não em cada chamador. E
teste com uma prova de conceito de verdade antes e depois.

### 12.2 Escape de vCard que não escapava, com teste que não podia falhar

O código usava `'\;'` em JavaScript, que é exatamente `';'` — ou seja, não escapava nada. E o teste
comparava com o mesmo literal errado, então passava sempre.

Dois aprendizados: a ordem do escape de vCard é **contrabarra primeiro**, depois `;`, `,` e quebra de
linha; e **expectativa de teste sobre escape precisa ser escrita em string crua**, nunca com a mesma
sintaxe que o código sob teste.

### 12.3 Arquivar um fluxo tornou outro impossível de salvar

Arquivar o fluxo B gerava problema de nível `error` no fluxo A que saltava para ele. Como salvar
rejeita qualquer erro, o fluxo A passou a responder 422 e o usuário perdia a edição ao tentar salvar.

Regra geral: **uma mudança de estado em um recurso não pode transformar outro recurso em algo que não
se consegue salvar.** Alvo arquivado é aviso; alvo inexistente é erro.

### 12.4 Destaque do simulador que nunca podia aparecer

O CSS mirava `.meu-no.ativo`, mas a biblioteca de canvas põe a classe no elemento de fora,
`.no-do-canvas.ativo .meu-no`. O destaque — a função principal da tarefa — era invisível, e nenhum teste
automatizado pegaria.

**Se a sua verificação não inclui abrir a tela, declare isso.** Teste de unidade não vê CSS.

### 12.5 Fuso horário errado no simulador

O simulador caía num fuso fixo em vez de usar o do workspace, e errava toda previsão de intervalo por
data ou faixa de horário fora daquele fuso. Passe o fuso explicitamente para todo cálculo de tempo, e
valide o nome do fuso em try/catch com queda para UTC — base importada traz coisas como `BRT`, que não
é um fuso válido.

### 12.6 Simulador mais permissivo que a produção

A produção recusa mensagem que ficou vazia depois da interpolação; o simulador enviava. O cliente
testava, dava certo, e falhava em produção.

**O simulador tem que falhar exatamente onde a produção falha.** Compartilhar o código puro é o que
garante isso.

### 12.7 Importação que quebrava tudo por um campo

Três defeitos no importador de fluxos de outra ferramenta:

- `"unresolved"` casava como `RESOLVED` por comparação de pedaço → use comparação exata e ancorada.
- Um fuso não padrão derrubava a importação inteira → try/catch por campo, terminando em uma pendência
  visível.
- Valor não reconhecido virava string vazia em silêncio → gere uma pendência, nunca um valor vazio.

**Na importação, o campo que você não entendeu vira pendência visível, nunca um valor plausível.**

### 12.8 Escrever em campo já publicado sem precisar

O controlador de chat gravava fila e responsável mesmo quando a configuração não os tinha, apagando o
que o atendente havia definido à mão em fluxos que já rodavam. Só escreva o que foi configurado.

### 12.9 Cota e vazamento de sessão no simulador

Sessões de simulação por usuário, com teto. A primeira versão devolvia erro ao bater o teto, e quem
recarregava a aba ficava sem conseguir simular. **Expulse a sessão mais antiga** em vez de recusar a nova.

### 12.10 Ritmo de disparo em massa

No disparo em massa, o teste de "não agenda para trás" passava com o bug presente: a ordem continuava
crescente, mas **dois envios saíam a 1 h de distância com intervalo configurado de 23 h**.

A propriedade a afirmar não é "a ordem é crescente", é **"a distância entre envios consecutivos nunca é
menor que o mínimo configurado"**. Afirme a propriedade que importa, não um sintoma dela.

### 12.11 Teste que não falha com o bug de volta

Vale como método, não como bug: depois de corrigir algo, **reintroduza o defeito e confirme que o teste
falha**. Foi assim que as armadilhas 12.2 e 12.10 apareceram. Um teste que passa com e sem o bug não
está testando nada.

---

## 13. Multi-tenant e segredos

- **Todo** acesso é escopado por workspace, inclusive as buscas por id. Buscar por id sozinho vaza a
  existência de recurso de outro cliente, e o salto entre fluxos é exatamente o lugar onde isso
  acontece primeiro.
- Credencial de WhatsApp, chave de IA, token de pixel e variável global sensível ficam **cifrados em
  repouso**, e nunca aparecem em resposta de API, log ou URL. O que a tela mostra é uma dica
  (últimos dígitos) e um booleano "configurado".
- Falha ao decifrar **não** cai para a chave de ambiente. Cair silenciosamente faz o cliente A usar a
  chave do cliente B.
- Variável global sensível é resolvida no momento do envio e **não é persistida no contexto da
  execução**, senão o segredo fica gravado no histórico.

---

## 14. Ordem sugerida de construção

Cada etapa é testável sozinha e entrega algo que funciona.

1. **Formato do fluxo + validação.** Sem canvas. Só o esquema, o versionamento com versão esperada e a
   lista de problemas.
2. **Pacote puro:** condições, seleção de aresta, interpolação. Com teste. É a base de tudo.
3. **Caixa de saída + fila.** Com um tipo de evento só.
4. **Conexão de WhatsApp:** pareamento, persistência de credencial, dedupe de entrada, envio de texto
   com id determinístico.
5. **Motor com três blocos:** gatilho, mensagem, condição. Fecha o ciclo ponta a ponta.
6. **Espera por resposta.** É aqui que entram trava, retomada por `stepId` e agrupamento — a parte mais
   difícil do motor. Não deixe para depois: ela muda o desenho do estado.
7. **Canvas.** Só agora. Com o formato estável, o editor é trabalho de interface.
8. **Os outros blocos**, em ordem de valor para o seu cliente.
9. **Simulador**, reaproveitando o pacote puro.
10. **Gatilhos por conexão** (seção 3), quando a operação do cliente depender disso.

**O que não adiantou antecipar:** canvas bonito antes do formato estável, e bloco exótico antes de a
espera por resposta estar sólida.

---

## 15. Dívida conhecida deste código

Para você não copiar junto:

- **Nada foi validado em navegador** de forma automatizada: o pacote web não tem ambiente de DOM nos
  testes. Monte isso desde o começo; teria pegado a armadilha 12.4.
- **Quatro migrações escritas à mão nunca foram aplicadas** a um banco real no momento em que este
  documento foi escrito, e um comando SQL de atualização atômica nunca rodou contra o Postgres.
- **Três mapeamentos de campo do importador são suposição**, por falta de acesso ao formato de
  exportação da outra ferramenta. Falham como pendência visível, de propósito.
- **O envio em massa nunca tocou um WhatsApp real.** O cálculo do ritmo está testado; a entrega não.

---

## Apêndice: operadores de condição

`equals`, `not_equals`, `contains`, `not_contains`, `exists`, `not_exists`, `greater_than`,
`less_than`, `in`, `not_in`, `between`, `not_between`.

Três detalhes que evitam comportamento esquisito:

- Comparação de ordem (`greater_than`, `less_than`, `between`) só vale entre **dois números ou duas
  strings**. Comparar número com string devolve falso em vez de resultado inventado — isso faz datas
  ISO e horários `HH:MM` funcionarem só comparando texto.
- `between` com início maior que o fim **dá a volta na meia-noite**: `22:00`–`06:00` é a madrugada.
- `in` e `contains` sobre lista funcionam por interseção, para o mesmo operador servir a "tem a
  etiqueta X" e "tem alguma destas etiquetas".
