# B — Aguarda Resposta

Data: 15/10/2026 · Programa: paridade Leona (A → B → C → D → E) · Depende de: A (portas)

## Objetivo

Bloco que pausa o fluxo até o contato responder, com saída "respondeu" e saída "timeout", como o `wait_response` da Leona. No funil exportado ele aparece 5 vezes e é a espinha do fluxo (espera o comprovante, espera nova tentativa).

## Comportamento

- Ao entrar no bloco, a execução fica `WAITING` no próprio bloco (mesma mecânica de espera/retomada do Menu, generalizada: `pendingMenu` → `pendingWait { stepId, nodeId, kind: 'menu' | 'reply' }`).
- **Resposta**: a próxima mensagem recebida na conversa retoma a execução pela porta `reply`, gravando `last_message` (texto, ou legenda da mídia) e `last_message_type` (`TEXT`, `IMAGE`, `DOCUMENT`, `AUDIO`, `VIDEO`). Mídia recebida fica disponível para o Bloco de IA (spec A §4).
- **Buffer** (`bufferSeconds`, padrão desligado; Leona usa 30): ao chegar a primeira mensagem, espera N segundos juntando as seguintes; `last_message` vira o texto concatenado (quebra de linha) e a mídia considerada é a última recebida. Evita que "oi" + "segue o comprovante" + imagem disparem três retomadas.
- **Timeout**: `timeoutValue` + `timeoutUnit` (`minutes` | `hours` | `days`), máximo **31 dias**. Ao expirar, segue a porta `timeout`; sem conexão em `timeout`, a jornada termina sem erro (como o Menu).
- **Esperar indefinidamente** (`waitIndefinitely`): sem timeout. Para não acumular execuções eternas, o limite técnico é 31 dias e a execução termina sem erro ao atingi-lo (equivale ao `wait_indefinitely` + `timeout_value: 31` do export).
- Mensagens recebidas enquanto a execução **não** está esperando seguem as regras atuais (gatilhos).

## Editor

Bloco "Aguarda Resposta" (laranja, como na Leona): "Aguardar pela resposta do cliente." com alça `reply`; "Ou caso não responda" + "Após X {unidade}" com alça `timeout` (oculta quando "esperar indefinidamente"). Modal: tempo + unidade, "Esperar indefinidamente", "Juntar mensagens por N segundos".

## Compiler

`wait_response` expõe portas `reply` (obrigatória) e `timeout` (opcional; inválida com `waitIndefinitely`). Ciclo `timeout → wait_response` é permitido (o export tem dois) e já gera só aviso de ciclo.

## Fora de escopo

"Responder ao lead" e "Reagir à mensagem do lead" da Leona — desligados em todos os blocos do export; entram como campos ignorados pelo importador, com aviso se ligados.

## Testes

Unitários: resolução de porta por resposta e por timeout; buffer concatenando mensagens; timeout ausente com `waitIndefinitely`; resposta que chega depois do timeout é ignorada; Menu continua funcionando com a espera generalizada (testes atuais do Menu verdes).
