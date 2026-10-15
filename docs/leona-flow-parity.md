# Paridade do construtor de fluxos com o Leona

Auditoria do cliente público do Leona realizada em 15/10/2026. Este documento separa paridade funcional de semelhança visual: um bloco só é marcado como pronto quando editor, validação e runtime executam a mesma configuração.

## Blocos já disponíveis no Nexo

| Nexo | Equivalente Leona | Estado | Comportamento atual |
| --- | --- | --- | --- |
| Gatilho | Início | Pronto | Inicia por mensagem recebida, conversa criada ou etiqueta adicionada. |
| Mensagem | Mensagem | Parcial | Texto e variáveis funcionam. Imagem, áudio e figurinha funcionam como blocos próprios. Ainda faltam conteúdo múltiplo ordenado, upload, vídeo, arquivo, contato, variação por IA e atraso de digitação. |
| Menu interativo | Menu | Parcial | Runtime pronto: botões (até 3) ou lista (até 10), espera a escolha, uma saída por opção, saída por inatividade (0 = 2 dias, máx. 31) e resposta salva em variável. Falta o editor do bloco igual ao Leona para ligar as saídas por opção. |
| Condicional | Condicional | Parcial | Ramifica por campo, operador, prioridade e rota padrão. Ainda faltam grupos de regras AND/OR no próprio bloco e os atalhos de condição do Leona. |
| Intervalo inteligente | Intervalo inteligente | Parcial | Intervalo real em segundos, minutos, horas ou dias, com retomada pela fila e limite de 31 dias. Ainda faltam data exata e janelas semanais. |
| Etiquetas | Etiquetas | Pronto | Adiciona ou remove várias etiquetas; permite selecionar existentes e criar por nome ao adicionar. |
| Integração | Integração | Pronto para HTTP básico | GET, POST e PUT, cabeçalhos, corpo com variáveis e resposta salva no contexto. Ainda faltam saídas visuais separadas de sucesso e erro. |
| Bloco de IA | Bloco de IA | Parcial | Executa agente configurado, usa base de conhecimento e transfere por baixa confiança. Ainda faltam leitura multimodal e múltiplas condições inteligentes do Leona. |
| Departamento | Departamento | Parcial | Atribui fila ou responsável. A seleção visual de departamentos e membros ainda deve substituir os campos livres. |
| Handoff | Controle de chat | Pronto no escopo atual | Muda a conversa para atendimento humano, fila e status de espera. |
| Resultado | Resultado interno | Pronto | Encerra a execução e registra o desfecho de negócio do Nexo. |

## Blocos vistos no Leona que ainda não existem no Nexo

- Aguarda Resposta, com saída por resposta e por timeout, buffer e variável de resposta.
- Distribuidor de contatos.
- Notificação interna.
- Conexão de fluxo.
- Kanban, manipulador de dados e pixel.
- Pagamentos, PIX, venda aprovada, LeonaPay e ligação.
- Integrações específicas de terceiros.

## Ordem segura para concluir a paridade

1. Editor do Menu e Aguarda Resposta; a retomada por mensagem recebida já existe para o Menu e pode ser reaproveitada.
2. Condicional com grupos AND/OR no bloco e catálogo de condições.
3. Mensagem como sequência de conteúdos, mantendo os blocos antigos compatíveis.
4. Intervalo por data/janela semanal e calendário comercial.
5. Saídas de sucesso/erro para Integração e IA.
6. Blocos operacionais restantes conforme prioridade de produto.

