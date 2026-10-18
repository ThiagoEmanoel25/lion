# G — Blocos da Leona que faltam no Nexo

Data: 18/10/2026 · Programa: paridade Leona (A → … → F → **G**)
Base: análise de `docs/Fluxo1.json` e `docs/fluxo2.json` a `fluxo5.json`. São os funis GELATINA-FUNIL-01 a 05, com 90 blocos e 120 conexões no total. Os arquivos não são versionados porque contêm chaves.

## Inventário

| Leona (bloco / ação) | Uso nos 5 fluxos | Nexo hoje |
|---|---|---|
| `message` (`send_message`, `send_file`, `send_multi_media` imagem, `delay_between_messages`) | 28 blocos | ✅ Mensagem em sequência (C) |
| `wait_response` (`wait_for_response`) | 14 | ✅ Aguarda Resposta (B); ⚠️ ver §4, §5 e §7.1 |
| `condition` (etiqueta; campo `resposta.gpt` contém / não contém) | 12 | ✅ Condicional; ⚠️ campo do contato (§4) |
| `tags` (`add_tags`) | 8 | ✅ Etiquetas |
| `ai` (`ai_call`, gpt-5-mini / gpt-5.4-mini, imagem/PDF/áudio) | 6 | ✅ IA direta (A) com áudio |
| `integration` (`make_http_request`) | 3 | ✅ Integração (A/F) |
| `pixel` (`send_pixel_event`, Compra) | 3 | ✅ Pixel (F) |
| `kanban` sem ação | 1 | ✅ removido como passagem |
| **`connection_flow` (`execute_flow`)** | **5**, liga FUNIL-01 → 02 → 03 → 04 → 05 | ❌ **falta (§1)** |
| **`distributor` (`distribute_contacts`)** | **3**, cada um com 5 saídas | ❌ **falta (§2)** |
| **`notification` (`send_notification`)** | **2** ("ERRO IA" para um número da equipe) | ❌ **falta (§3)** |
| **`save_user_data`** dentro do Aguarda Resposta | **2**: grava a resposta em `resposta-lead`, lida no FUNIL-03 | ❌ **falta (§4)** |
| `wait_for_response` com `reply_to_lead_enabled` / `react_to_lead_check_enabled` | 1 | ❌ fora do escopo da spec B; **agora usado (§5)** |
| `send_multi_media` de áudio com `audio_forward` e `typing_delay_seconds` | 4 áudios | ⚠️ falta "gravando…" e "encaminhado" (§6) |
| `send_message` **dentro** do bloco Aguarda Resposta | 2 | ⚠️ o importador descarta a mensagem (§7.1) |

Sem os itens marcados com ❌, os funis não funcionam de ponta a ponta:
- o FUNIL-01 termina no bloco que chama o 02, e assim por diante;
- o teste A/B dos distribuidores não acontece;
- o FUNIL-03 decide pela resposta que o 02 gravou.

---

## 1. Bloco "Ir para outro fluxo" (`flow_jump`)

**Config:**
- `targetPlaybookId`: o fluxo de destino, no mesmo workspace;
- `leonaFlowId?` e `targetName?`: preenchidos só pela importação, para resolver depois.

**Saídas:** nenhuma. É um bloco final, como Handoff e Resultado, e o compiler o trata como terminal.

**Execução:**
1. Termina a execução atual como `SUCCEEDED` e grava `output { jumpedTo }`.
2. Na mesma transação, cria a execução do **fluxo de destino**, usando a versão ativa dele, na mesma conversa. Isso passa por cima do gatilho e da regra "uma vez por contato", porque o salto é explícito.
3. O contexto novo começa limpo, como num início normal, mais `_runtime.jumpDepth = anterior + 1`.

**Proteção contra laço:** com `jumpDepth > 10`, a execução falha com `FLOW_JUMP_LIMIT`.

**Falhas:**
- destino sem versão publicada: `FLOW_JUMP_TARGET_UNPUBLISHED`;
- destino excluído: `FLOW_JUMP_TARGET_NOT_FOUND`;
- o compiler acusa `FLOW_JUMP_TARGET_REQUIRED`.

**Editor:** select de fluxos do workspace, que não lista o próprio fluxo. Se veio da importação sem destino resolvido, mostra "Na Leona: GELATINA-FUNIL-02 — escolha o fluxo correspondente".

## 2. Bloco "Distribuidor" (`distributor`)

Divide os contatos entre várias saídas, para teste A/B de copy.

**Config:**
- `outputs[]`: de 2 a 10 itens `{ id, name, weight }`, com `weight` inteiro de 1 a 100 (padrão 1);
- `preventRepeat`: padrão `true`.

**Roteamento:**
- As conexões usam `condition { field: 'distributor.output', operator: 'equals', value: <id> }`, no mesmo padrão do Menu com saídas por opção.
- O compiler exige uma conexão por saída.

**Escolha da saída:** round-robin ponderado e determinístico. Escolhe a saída com o menor `atribuídos / peso` e desempata pela ordem.

**Contadores:** tabela `FlowDistributorCount { playbookId, nodeId, outputId, count }`, com `@@unique([playbookId, nodeId, outputId])`. O incremento é atômico:
```sql
update … set count = count + 1 where …
```

**`preventRepeat`:**
- Grava `FlowDistributorAssignment { playbookId, nodeId, contactId, outputId }`, com `@@unique([playbookId, nodeId, contactId])`.
- O contato que volta ao bloco sai sempre pela mesma saída.
- Se essa saída tiver sido removida, recebe outra e a atribuição é atualizada.

**Editor:**
- lista de saídas: nome, peso, "+ Saída" e remover;
- alça por saída no nó;
- contadores ao lado de cada saída, por exemplo "235 contatos", vindos de `GET /v1/playbooks/:id/distributors`.

**Importação:**
- `outputs[].id/name` → saídas com peso 1.
- `quantity` (235, 235, 234…) parece ser contagem de contatos já distribuídos, não peso. Não é migrado, e o relatório avisa: "Contadores do distribuidor recomeçam do zero".
- `prevent_repeat` → `preventRepeat`.
- O handle `output-<id>` vira a condição da saída.

## 3. Bloco "Notificação interna" (`notification`)

Envia um aviso por WhatsApp para um número da equipe. No funil ele é usado como "ERRO IA" na saída de erro da IA.

**Config:**
- `phone`: E.164, com DDI;
- `message`: de 1 a 1024 caracteres, aceita variáveis;
- `name?`: rótulo.

**Saída:** uma só, que segue sempre. A notificação não pode derrubar o funil do cliente.

**Execução:**
1. Interpola a mensagem.
2. Grava um `outboxEvent` `notification.send.requested` com `{ channelId: <canal da conversa>, phone, text }`.
3. O worker de envio manda direto para `<phone>@s.whatsapp.net` pelo socket do canal.

Detalhes:
- Não cria contato nem conversa no inbox.
- Até 3 tentativas. A falha é só registrada e não afeta a execução.
- Limite de **30 notificações por hora por workspace**. Acima disso a notificação é descartada e o descarte é registrado, para que um laço não vire spam para a equipe.

**Importação:** `country_code` + `phone` → `phone` (`+55…`), `message`, `name`. As variáveis passam pela tradução já existente.

## 4. Guardar a resposta em um campo do contato

Na Leona, `save_user_data` (dentro do Aguarda Resposta) grava a resposta no **contato**. O FUNIL-03 lê o campo `resposta-lead` gravado no FUNIL-02, então o valor precisa sobreviver entre fluxos.

**Aguarda Resposta** ganha:
- `saveReplyTo?`: nome de campo personalizado do contato, de 1 a 60 caracteres, `[\w.-]`;
- `saveEmpty`: padrão `true`.

**Na resposta**, além de `last_message`:
- grava `contact.customFields[saveReplyTo] = last_message`;
- com `saveEmpty: false` e texto vazio (só mídia), não grava.

**Condicional:** o catálogo já tem "Campo personalizado" (`contact.customFields.<nome>`). Ele é carregado no contexto ao vivo da condição, então o valor gravado num fluxo é visto pelo outro.

**Importação:**
- `save_user_data.field_name`, sem chaves (`{resposta-lead}` → `resposta-lead`), vira `saveReplyTo`, e `save_empty` vira `saveEmpty`.
- Regra `custom_field` da Condicional:
  - se o `fieldName` é produzido **no próprio fluxo** (`response_variable` ou `fail_reason_variable` da IA, variáveis de `response_mapping` da Integração), vira **variável do fluxo**, como hoje (`resposta.gpt`);
  - caso contrário, vira `contact.customFields.<fieldName>`.
  - Isso inclui `resposta-lead`.
  - O `systemSubtype: 'tag'` que aparece nessas regras é ignorado.

## 5. Aguarda Resposta: reagir e responder ao lead

**Config nova:**
- `reactEmoji?`: um emoji;
- `replyToLeadCount`: de 0 a 10, padrão 0.

**Ao receber a resposta:**
- Com `reactEmoji`, envia a reação a essa mensagem do lead com `{ react: { text, key } }` no Baileys, pelo worker de envio.
- Com `replyToLeadCount = N`, as próximas N mensagens de texto ou mídia enviadas **nesta execução** saem como resposta citando a mensagem do lead (`quoted`).
  - O contador fica em `_runtime.quoteNext = { messageId, remaining }`.
  - A mensagem enviada leva `providerPayload.quotedMessageId`.

**Importação:**
- `react_to_lead_check_enabled` + `react_to_lead_reaction_emoji` → `reactEmoji`;
- `reply_to_lead_enabled` + `reply_to_lead_next_messages_count` → `replyToLeadCount`.

## 6. Áudio: "gravando…" e encaminhado

O item `media` da Mensagem (spec C) ganha:
- `typingSeconds` (0–60): em áudio, mostra **"gravando áudio…"** (presença `recording`); em imagem e vídeo, "digitando…". Usa o mesmo mecanismo de atraso sem `sleep` que o texto já usa.
- `forwarded`: padrão `false`. Envia com `contextInfo.isForwarded = true`, e o WhatsApp mostra "Encaminhada".

**Importação:** `typing_delay_seconds` → `typingSeconds`; `audio_forward` → `forwarded`. O áudio é importado com `ptt: true`, porque os funis mandam como nota de voz.

**A confirmar com o usuário:** que `audio_forward` na Leona é mesmo "enviar como encaminhado", e não "enviar como gravado na hora". O print da opção na Leona resolve.

## 7. Importador

1. **Mensagens dentro do Aguarda Resposta.** Ações `send_message`, `send_file` ou `send_multi_media` antes do `wait_for_response`:
   - o bloco é **dividido** em um bloco Mensagem com esses itens, ligado a um Aguarda Resposta com a config de espera;
   - a entrada vai para a Mensagem, e as saídas `reply`/`timeout` ficam no Aguarda Resposta;
   - posição deslocada 40 px;
   - relatório: "ajustado".
2. **Origem do fluxo.** O favorito passa a enviar `sourceFlowId`, lido do número na URL do editor da Leona, por exemplo `/flows/140360`.
   - O Nexo grava `Playbook.importSource = { system: 'leona', flowId }`.
   - `execute_flow` resolve `target_flow_id` por `importSource.flowId` e, se não achar, por nome (`target_flow_name`, sem diferenciar maiúsculas). Sem destino, vira pendência.
   - **Orientação na tela de importação:** importar do último funil para o primeiro (05 → 01), para os destinos já existirem.
3. **Distribuidor, notificação, `save_user_data`, reagir/responder e áudio:** conforme §2–§6.
4. **Fixtures.** Cópias redigidas dos 5 fluxos são geradas pelo controlador:
   - `api_key`, `Authorization`, `page_id` e o `phone` da notificação viram marcadores;
   - ficam em `apps/api/src/modules/imports/fixtures/`.
   - Testes por fluxo conferem:
     - nenhum texto provisório;
     - o número de blocos depois das divisões e remoções;
     - as conexões do distribuidor;
     - os saltos de fluxo resolvidos quando os destinos foram importados antes;
     - `resposta-lead` como campo do contato;
     - os totais do relatório.

## Fora de escopo

- Migrar os contadores do distribuidor.
- Saltar para fluxo de outro workspace.
- Notificação por e-mail.
- Reação a mensagens fora do Aguarda Resposta.

## Ordem sugerida

1. §7.1 e §4: dividir o Aguarda Resposta e guardar a resposta no contato.
2. §1: salto entre fluxos.
3. §2: distribuidor.
4. §3: notificação.
5. §5 e §6: reagir e responder, áudio.

Essa ordem faz o FUNIL-01 → 05 rodar ponta a ponta o quanto antes.

## Testes

**Puros:**
- escolha ponderada do distribuidor, com contadores e com repetição;
- `jumpDepth`;
- E.164 da notificação;
- regra fluxo × contato na Condicional;
- divisão do Aguarda Resposta;
- montagem de reação e citação;
- presença `recording`.

**API:** permissões e isolamento por workspace no endpoint de contadores; o compiler aceita os blocos novos.

**Importador:** as fixtures dos 5 fluxos.

**Engine:** traços manuais no relatório, como nas specs anteriores. Sem chamadas reais ao WhatsApp nos testes.
