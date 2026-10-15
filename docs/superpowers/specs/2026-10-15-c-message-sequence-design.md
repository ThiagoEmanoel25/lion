# C — Mensagem como sequência

Data: 15/10/2026 · Programa: paridade Leona (A → B → C → D → E)

## Objetivo

Um bloco Mensagem envia uma **sequência ordenada** de conteúdos, como a Leona. No funil exportado, um único bloco tem 11 ações (texto, arquivo, pausa, arquivo, pausa…), e outros têm 5 textos seguidos.

## Conteúdos (`config.items`, 1 a 30 itens)

| Tipo | Campos | Equivale na Leona |
|---|---|---|
| `text` | `text` (1–4096, variáveis `{{…}}`), `typingSeconds` (0–30) | `send_message` (`message_text`, `typing_delay_seconds`) |
| `file` | `url` HTTPS, `fileName`, `caption?` | `send_file` |
| `media` | `mediaType` (`image`/`video`/`audio`), `url` HTTPS, `caption?`, `ptt?` | `send_multi_media` / imagem e áudio atuais |
| `pause` | `minSeconds`, `maxSeconds` (0–300, min ≤ max) | `delay_between_messages` |

- `typingSeconds` mostra "digitando…" (presença `composing` do Baileys) pelo tempo indicado antes de enviar o texto.
- `pause` espera um tempo aleatório entre min e max.
- Os blocos atuais `message` (texto único), `image`, `audio`, `sticker` continuam funcionando; o editor converte um `message` antigo em sequência de um item ao abrir, e salva no formato novo.

## Ordem garantida

O envio hoje é paralelo (até 20 por vez). Para a sequência:
- O engine executa os itens um a um. Cada item cria a mensagem e o pedido de envio; o **próximo item só é agendado depois que o anterior foi enviado** (`SENT`/`DELIVERED`) ou falhou, verificado por um job de continuação com cursor (`pendingSequence { stepId, index }`) — mesma família de espera do Intervalo e do Aguarda Resposta.
- Atrasos (`typingSeconds`, `pause`) viram o `delay` do job de continuação; nenhum `sleep` dentro do worker.
- Falha de envio de um item: o item fica `FAILED`, o bloco falha a execução com o índice do item (comportamento atual de envio).

## Editor

Modal da Mensagem com lista de conteúdos reordenável (arrastar ou setas), botões "+ Texto", "+ Arquivo", "+ Mídia", "+ Pausa"; cada texto com barra de formatação (a mesma do Menu) e campo "digitando por N s". O nó mostra o primeiro texto e "+N conteúdos".

## Fora de escopo

Upload de arquivo pelo Nexo (os itens usam URL HTTPS; os arquivos do export já são URLs diretas); variação de texto por IA; contato/localização.

## Testes

Unitários: validação dos itens; avanço do cursor só após `SENT`; cálculo do atraso (digitação + pausa aleatória com semente controlada); conversão do `message` antigo.
