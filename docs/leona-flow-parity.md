# Paridade do construtor de fluxos com o Leona

Revisão: **20/10/2026**. A primeira auditoria foi feita em 15/10/2026, sobre o cliente público do Leona. Esta revisão confere o estado contra o código do Nexo e contra os 5 exports reais (fixtures redigidas em `apps/api/src/modules/imports/fixtures/`).

Um bloco só conta como **pronto** quando o editor, a validação de publicação e o runtime executam a mesma configuração. Ficar parecido na tela não basta.

> Ainda falta um estudo pelo navegador do Leona logado, com a skill `reverse-engineering-saas` e o gravador de formato de API. Ele ainda não foi feito: na última tentativa, a extensão do Chrome estava desconectada. Os itens marcados "a confirmar" dependem desse estudo.

## Regra geral que mudou em 19/10

**Bloco sem saída encerra o fluxo**, como no Leona. Antes, o Nexo bloqueava a publicação nesse caso. Agora:

- Bloco sem ligação, saída de sucesso sem ligação, Condicional com um caminho solto e "respondeu" sem ligação: o bloco executa e a execução termina como **concluída**. Na publicação aparece só um aviso.
- Integração, Pixel ou IA que **falha** sem saída de erro ligada: a execução termina como **falha**, com o motivo.
- O fluxo não precisa mais ter um bloco Resultado ou Handoff.

## Blocos

| Nexo | Leona | Estado | O que o Nexo faz hoje |
| --- | --- | --- | --- |
| Gatilho | Início | Pronto | Mensagem recebida, conversa criada ou etiqueta adicionada. Opção "uma vez por contato". O export do Leona não traz o gatilho; a importação assume mensagem recebida, uma vez por contato. |
| Mensagem | Mensagem | Pronto | Sequência ordenada de texto, arquivo, mídia e pausa, com "digitando…" e "gravando áudio", encaminhado e citação. Upload privado de mídia pelo editor. |
| Menu interativo | Menu | Pronto | Botões (até 3) ou lista (até 10), uma saída por opção, saída por inatividade, resposta salva em variável. |
| Aguarda Resposta | Aguarda Resposta | Pronto | Saídas "respondeu" e "não respondeu", espera indefinida, buffer de mensagens, salvar em campo do contato (gravação atômica), reagir, responder citando, e **mensagem antes de aguardar** (enviada antes de começar a esperar). Editor no padrão do design system; bloco no canvas com o visual do Leona. |
| Condicional | Condicional | Pronto | Todas/qualquer regra sobre etiqueta, dia, hora, data, janela de 24h, status, atendente, Kanban, campos e variáveis do fluxo, sempre com o estado atual da conversa. Bloco no canvas com o visual do Leona ("Etiqueta igual X" / "Caso não atenda…"). |
| Intervalo inteligente | Intervalo inteligente | Parcial | Espera de segundos a 31 dias. **Falta:** data exata e janelas semanais (a confirmar se os funis usam). |
| Etiquetas | Etiquetas | Pronto | Adiciona ou remove várias etiquetas; o bloco mostra as etiquetas em chips, como no Leona. |
| Integração | Integração | Pronto | GET/POST/PUT, cabeçalhos, corpo com variáveis, mapeamento de campos da resposta, saídas de sucesso e erro, teste pelo editor e 30 s de limite. URL bloqueada ou erro de DNS vão para a saída de erro. |
| Bloco de IA | Bloco de IA | Pronto | OpenAI com chave cifrada do workspace. Entende imagem, PDF e áudio (transcrito antes), condicionais inteligentes, identifica comprovante e tem saída de erro. A resposta fica em `ai.response` e também na variável configurada (os funis usam `resposta.gpt`). Logo depois de um Aguarda Resposta, lê a mensagem que encerrou a espera, preferindo a mídia. |
| Departamento | Departamento | Parcial | Atribui fila ou responsável. **Falta:** escolher departamento ou membro numa lista; hoje são campos de texto livre. |
| Handoff | Controle de chat | Pronto | Passa para atendimento humano, com fila e status. |
| Resultado | — (só no Nexo) | Pronto | Encerra e registra o desfecho de negócio. |
| Kanban | Kanban | Pronto | Cria ou move o card para uma coluna; a Condicional lê a coluna. |
| Pixel | Pixel | Pronto | Conversions API da Meta, token cifrado, `ctwa_clid` capturado do anúncio, saídas de sucesso e erro, evento de teste pelo editor. |
| Conexão de fluxo | Conectar fluxo | Pronto | Inicia a versão publicada do fluxo de destino. Limite de 10 saltos seguidos. Destino pausado ou não publicado faz a execução falhar. |
| Distribuidor | Distribuidor de contatos | Pronto | Rodízio com pesos, opção de não repetir para o mesmo contato e contagem por saída. |
| Notificação | Notificação interna | Pronto | Envia aviso para um número E.164, limitado a 30 por hora, sem travar o fluxo. |

## O que ainda não existe no Nexo

- Pagamentos: PIX, venda aprovada, LeonaPay.
- Ligação.
- Manipulador de dados (a confirmar o que faz no Leona).
- Integrações prontas de terceiros (o caminho atual é o bloco Integração).
- Intervalo por data exata ou janela semanal.

Nenhum dos 5 funis GELATINA usa esses itens.

## Pontos abertos com impacto real

1. **Kovil não recebe o comprovante.** A Integração dos funis 03, 04 e 05 envia só telefone, número do chip e `flow_id`; o export do Leona é igual. O prompt da IA descreve um JSON "interno para integração de comprovantes". Tudo indica que a Kovil busca a resposta da IA no próprio Leona, e essa busca não vai encontrar nada quando o fluxo rodar no Nexo. É preciso confirmar com a Kovil se a API aceita o comprovante no corpo (por exemplo `"receipt": "{{resposta.gpt}}"`).
2. **Arquivos hospedados no Leona.** A importação marca quais mídias continuam com URL do Leona. Elas podem sair do ar se a conta for cancelada; o caminho é reenviar pelo upload do editor.
3. **Significado de `audio_forward`** e se a `quantity` do distribuidor é um contador (perguntas abertas da spec G).

## Detalhes da importação

- O importador lê `data.actions[]` (`action_type` + `config`) e gera um relatório honesto. Valores de exemplo contam como pendência, e cada erro da validação vira um item do relatório.
- Credenciais nunca são copiadas: a chave da OpenAI, o header `Authorization` e o token do Pixel ficam de fora e precisam ser configurados no Nexo.
- Etiquetas, colunas do Kanban, pixels (por nome) e saltos entre fluxos são resolvidos no workspace de destino. Um salto só é mantido se o fluxo de destino existir nesse workspace.
- Uma condição cujos dois caminhos vão para o mesmo bloco é removida, porque não decide nada.
- Script para importar os exports: `apps/api/scripts/import-leona-files.ts`.
