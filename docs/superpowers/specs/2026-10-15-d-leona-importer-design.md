# D — Importador de fluxos da Leona (por código)

Data: 15/10/2026 · Programa: paridade Leona (A → B → C → D → E) · Depende de: A, B, C

## Objetivo

Trazer um fluxo da Leona para o Nexo **sem o usuário manipular JSON**, com a mesma experiência de "código" que a Leona usa entre contas — e oferecer o mesmo mecanismo entre contas Nexo.

## Por que não resolver o código da Leona direto

O código de compartilhamento da Leona é resolvido pelos servidores dela, atrás da autenticação da conta e de uma cifra própria (`editor_bundle` com `_z: "v3"`, conteúdo em `_q`). Usá-lo a partir do Nexo exigiria agir como o usuário na API privada da Leona e quebrar essa cifra — fora de questão. O fluxo, porém, já está decifrado no editor da Leona quando o próprio usuário o abre; o importador captura dali.

## Experiência

1. No Nexo, Fluxos → **Importar da Leona**. O Nexo mostra um **código de importação** (8 caracteres, válido por 15 minutos, uso único) e o botão **"Exportar para o Nexo"** para arrastar à barra de favoritos (instalado uma vez).
2. Na Leona, com o fluxo aberto, o usuário clica no favorito e digita o código.
3. O favorito lê o fluxo do editor (nós e conexões do React Flow — o mesmo do script de console usado na análise) e envia ao Nexo.
4. A tela do Nexo (que esperava o código) mostra o resultado: novo fluxo em **rascunho** + relatório.

## Captura (favorito)

- Código fixo servido pelo Nexo (`javascript:` com o endereço do Nexo embutido). Lê `nodes`/`edges` do editor; se não encontrar o editor, avisa "Abra um fluxo no editor da Leona".
- Envia `POST /v1/imports/leona/:code` (rota pública, CORS liberado só nela, sem cookies), corpo `{ source: 'leona', version: 1, nodes, edges, label? }`, **máx. 2 MB**.
- O Nexo valida o código (existe, não expirou, não usado), grava o payload, marca o código como usado e responde só `{ ok: true }`. Rate limit por IP e por código.

## Conversão (servidor, função pura e testável)

| Leona | Nexo |
|---|---|
| `start` | `trigger` (mensagem recebida) |
| `message` (`send_message`, `send_file`, `send_multi_media`, `delay_between_messages`) | `message` com `items` (spec C) |
| `wait_response` | `wait_response` (spec B) |
| `condition` (`system/tag`, `custom_field`) | `condition` com regras do catálogo: etiqueta por **nome** → id no workspace (criada se não existir); `custom_field` → Variável do fluxo / Campo personalizado |
| `ai` (`ai_call`) | IA direta (spec A); `api_key` **não** é copiado para o bloco — se o workspace não tem chave, a tela oferece "salvar esta chave no workspace" (opt-in explícito) |
| `integration` (`make_http_request`) | `webhook` com `responseFields` (spec A) |
| `tags` (`add_tags`) | `tag` (adicionar por nome) |
| `kanban` sem ação | removido, ligando a entrada direto à saída (no-op idêntico) |
| `kanban` com ação | bloco Kanban (spec E) por nome de quadro/coluna; o importador encontra ou cria o destino no workspace |
| `pixel` e tipos desconhecidos | removido com ligação direta + **pendência** no relatório ("Pixel não migrado: evento Compra 15,00 BRL") |

Conexões: `sourceHandle` `success`/`failure` → `port`; `client-response` → `reply`; `timeout` → `timeout`; Condicional `success`/`failure` → saída atendida / "Caso contrário"; sem handle → conexão simples. IDs da Leona viram `leona_<id>`; posições preservadas.

Variáveis (`{nome}` → `{{caminho}}`): `phone_number` → `contact.phone`; `first_name` → `contact.firstName`; `last_message` → `last_message`; `instance_number` → `channel.phone`; demais (`link_grupo` no export) → `contact.customFields.<nome>` com pendência para conferir.

## Relatório

Lista por bloco: convertido, convertido com ajuste (ex.: etiqueta criada), pendência (Pixel, variável desconhecida, chave de IA ausente). O fluxo nasce em rascunho e só publica depois que o compiler valida.

## Compartilhamento entre contas Nexo

Exportar um fluxo do Nexo gera um código (30 dias, multiuso, revogável) que guarda uma cópia da definição **sem segredos** (cabeçalhos `Authorization` e afins removidos e listados como pendência). Importar o código em outra conta cria o rascunho com o mesmo relatório.

## Fora de escopo

Importar vários fluxos de uma vez; migrar contatos/histórico; resolver códigos da Leona.

## Testes

Conversor coberto por fixture **redigida** derivada do export real (sem chaves): contagem de blocos/conexões, cada mapeamento da tabela, variáveis, etiquetas por nome, no-op do Kanban vazio, pendência do Pixel. Rota pública: código expirado/usado/inexistente, limite de tamanho.
