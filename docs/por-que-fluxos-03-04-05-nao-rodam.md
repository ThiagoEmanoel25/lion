# Por que os fluxos 03, 04 e 05 ainda não rodam

Data da revisão: **20/10/2026** (primeira versão em 19/10).

## Resumo

O FUNIL-01 e o FUNIL-02 já estão **publicados**. Os fluxos 03, 04 e 05 foram importados e existem no Nexo, mas continuam como **rascunho (DRAFT), versão 1, sem versão publicada**. Por isso, o encadeamento para neles: o runtime só executa uma Conexão de Fluxo quando o fluxo de destino possui uma versão publicada.

No teste do WhatsApp, o FUNIL-01 e o FUNIL-02 chegaram a executar. Ao tentar continuar para o FUNIL-03, o runtime encerrou a execução com `FLOW_JUMP_TARGET_UNPUBLISHED` — “O fluxo de destino precisa ter uma versão publicada”. Isso não foi uma falha do Baileys.

| Fluxo | Estado atual | Erro que bloqueia a publicação |
| --- | --- | --- |
| GELATINA-FUNIL-03 | DRAFT, v1 | Bloco `leona_5338119` sem pixel selecionado |
| GELATINA-FUNIL-04 | DRAFT, v1 | Bloco `leona_5339422` sem pixel selecionado |
| GELATINA-FUNIL-05 | DRAFT, v1 | Bloco `leona_5346058` sem pixel selecionado |

Nos três casos, a validação retorna `INVALID_PIXEL_CONFIG: Pixel inválido: pixelId — Required`.

## Causa principal: PIXEL - MARITZA não foi resolvido

Os arquivos exportados da Leona referenciam um pixel chamado **PIXEL - MARITZA**, com identificador interno da Leona `3327`:

- [fluxo3.json](./fluxo3.json): bloco de pixel na região do `flow_node_id` `5338119`;
- [fluxo4.json](./fluxo4.json): bloco de pixel na região do `flow_node_id` `5339422`;
- [Fluxo5.json](./Fluxo5.json): bloco de pixel na região do `flow_node_id` `5346058`.

O identificador `3327` não pode ser reutilizado no Nexo, porque pertence à conta da Leona. Por segurança, o importador procura no workspace um pixel cadastrado com o mesmo nome. Como **PIXEL - MARITZA ainda não existe no workspace**, ele mantém os dados não secretos do evento (Purchase, BRL, valor e Page ID), remove o identificador externo e deixa o campo `pixelId` pendente.

Essa pendência é bloqueante porque publicar um fluxo sem saber qual credencial da Meta deve ser usada faria o evento de compra falhar ou, pior, ser enviado para uma conta errada.

## Situação de cada fluxo

### GELATINA-FUNIL-03

O FUNIL-03 recebe a continuidade do FUNIL-02, analisa o comprovante com IA, envia o evento de compra ao Pixel, chama a Kovil e então direciona o contato para o FUNIL-04 ou o FUNIL-05.

Bloqueio:

- `leona_5338119`: pixel sem `pixelId` do workspace.

Avisos não bloqueantes:

- `leona_5338571`: uma notificação não possui saída; nessa rota o fluxo termina após avisar a equipe;
- `leona_5346577`: a saída “Condição atendida” não está conectada; se a condição for atendida, essa rota termina.

Esses dois avisos não impedem a publicação. Desde 19/10, bloco sem saída encerra o fluxo como **concluído**, igual ao Leona, então o comportamento é o mesmo do fluxo original. Vale confirmar que é o esperado.

### GELATINA-FUNIL-04

O FUNIL-04 repete etapas de solicitação/análise de comprovante e, quando concluído, continua para o FUNIL-05.

Bloqueio:

- `leona_5339422`: pixel sem `pixelId` do workspace.

Avisos não bloqueantes:

- há ciclos envolvendo os nós `leona_5338982`, `leona_5339711`, `leona_5339947` e `leona_5342368`;
- os ciclos representam novas tentativas/retomadas importadas da Leona e ficam protegidos pelo limite `maxSteps = 100`.

Os ciclos não bloqueiam a publicação, mas devem ser testados para confirmar que o contato não repete mensagens além do esperado.

### GELATINA-FUNIL-05

O FUNIL-05 é a etapa final: entrega materiais, analisa comprovante, registra o evento de compra e chama a Kovil.

Bloqueio:

- `leona_5346058`: pixel sem `pixelId` do workspace.

Avisos não bloqueantes:

- `leona_5346207`: rota sem saída, encerrando o fluxo naquele ponto;
- `leona_5346541`: mensagem sem entrada, inalcançável e sem saída;
- `leona_5345766`: ciclo protegido por `maxSteps`.

O nó `leona_5346541` deve ser removido ou conectado antes da homologação, embora atualmente não bloqueie a publicação.

## Outras dependências para o teste real

Resolver o Pixel permite publicar, mas o teste ponta a ponta ainda depende de:

1. **Kovil — comprovante não é enviado (ponto mais importante).** A Integração envia só `customer_phone`, `chip_number` e `flow_id`; o export do Leona é igual. A resposta da IA (o JSON com valor, referência e data do comprovante) **não vai no corpo**. O prompt chama esse JSON de "interno para integração de comprovantes", o que indica que a Kovil busca a análise direto no Leona. Rodando no Nexo, essa busca não encontra nada e o comprovante tende a ser recusado mesmo com o token certo. Antes de homologar, confirmar com a Kovil se a API aceita o comprovante no corpo; se aceitar, acrescentar o campo (ex.: `"receipt": "{{resposta.gpt}}"`) nos três fluxos.
2. **Kovil — token:** nos três playbooks importados, a integração possui apenas o header `Content-Type`. O header `Authorization: Bearer ...` não está salvo na versão local, pois o export usado foi sanitizado. É necessário informar um token válido sem registrá-lo em documentação ou commit.
3. **OpenAI:** os blocos de IA precisam de uma chave válida. Em 20/10 o workspace local **ainda não tem chave salva**. O FUNIL-03 possui 1 bloco de IA, o FUNIL-04 possui 4 e o FUNIL-05 possui 1. Sem chave, cada bloco segue pela saída de erro (no 04 e no 05 ela volta para o Aguarda Resposta; no 03 vai para a Notificação "ERRO IA"). A IA continua gravando a resposta em `resposta.gpt` além de `ai.response`, então as Condicionais ("contém `#R$`" e "não contém `#R$0,00`") seguem valendo.
4. **Mídias da Leona:** links antigos podem expirar. O editor agora aceita upload privado de imagem, áudio, vídeo, documento e figurinha; arquivos indispensáveis devem ser reenviados pelo editor quando o link importado não responder.
5. **Evento da Meta:** para contatos que não vieram de anúncio de clique para WhatsApp, pode faltar `ctwa_clid`. Nesse caso, o bloco Pixel seguirá pela saída de erro mesmo estando corretamente configurado.

Corrigido em 19/10: depois de um Aguarda Resposta sem buffer, se o contato mandava a foto do comprovante e logo depois um texto ("segue o comprovante"), a IA lia só o texto. Agora ela lê a mensagem que encerrou a espera, preferindo a imagem, o PDF ou o áudio.

## Ordem correta para liberar

Como os fluxos possuem saltos entre si, a publicação deve ocorrer do destino final para o início:

1. cadastrar **PIXEL - MARITZA** em Configurações → Pixels do Facebook;
2. abrir cada bloco Pixel dos fluxos 03, 04 e 05 e selecionar o pixel cadastrado;
3. confirmar com a Kovil como o comprovante chega e configurar/testar o Bearer sem expor o token;
4. confirmar a chave da OpenAI;
5. revisar o nó inalcançável do FUNIL-05 e os avisos de término/ciclo;
6. validar e publicar **GELATINA-FUNIL-05**;
7. validar e publicar **GELATINA-FUNIL-04**;
8. validar e publicar **GELATINA-FUNIL-03**;
9. retestar o salto a partir do FUNIL-02.

## Critério de conclusão

Os três fluxos estarão prontos quando:

- a validação retornar `valid: true`;
- cada um tiver uma versão publicada ativa;
- o FUNIL-02 conseguir saltar para o FUNIL-03 sem `FLOW_JUMP_TARGET_UNPUBLISHED`;
- a IA analisar um comprovante real de teste;
- o Pixel seguir por sucesso ou por um erro esperado/documentado;
- a Kovil receber o comprovante, responder sem `401/403`, e os campos `accepted`, `duplicate` e `message` forem mapeados corretamente;
- o FUNIL-03 direcionar para 04/05 e o FUNIL-04 direcionar para 05.
