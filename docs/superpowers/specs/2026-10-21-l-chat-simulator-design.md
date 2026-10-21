# L — Simulador de fluxo em chat

Data: 21/10/2026  
Roadmap: item 2.1.

## Objetivo

Substituir a simulação por JSON como experiência principal por um chat local, interativo e sem efeitos externos. O JSON atual permanece recolhido em **Avançado**.

## Arquitetura

- Criar um `SimulationEngine` que reutiliza seleção de arestas, interpolação, condições e validação, mas usa adapters em memória.
- Nunca criar `Conversation`, `Message`, `Execution`, outbox ou jobs reais no modo padrão.
- Sessão efêmera no Redis por 30 minutos: definição não salva, contexto, nó atual, espera pendente, histórico e caminho.
- O browser recebe `simulationId`; qualquer usuário do workspace só acessa sessões criadas por ele.

## API

- `POST /v1/playbooks/:id/simulation-sessions`: `{definition, variables, liveActions:false}`.
- `POST /v1/playbooks/:id/simulation-sessions/:simulationId/messages`: resposta digitada ou opção do menu.
- `POST .../:simulationId/advance`: pula delay/timeout permitido.
- `POST .../:simulationId/restart` e `DELETE .../:simulationId`.
- Cada resposta traz `messages`, `activeNodeId`, `visitedNodeIds`, `waiting`, `completed`, `error?`.

## Comportamento por bloco

- Mensagem/mídia/notificação: cartão simulado, preservando ordem e pausa sem aguardar tempo real.
- Menu: botões/lista clicáveis.
- Aguarda Resposta: campo do cliente e ação **Pular para não respondeu** quando existe timeout.
- Delay: cartão e ação **Pular espera**.
- IA, Integração e Pixel: cartão “Simulado” e saída escolhida pelo usuário ou configuração avançada.
- Flow jump continua na definição ativa do destino carregada somente para leitura.
- Handoff/Resultado/Controlador encerram e explicam o motivo.

## Ações reais opcionais

- Toggle **Executar IA e Integração de verdade**, desligado por padrão.
- Exige `playbook.write`, confirmação por sessão e nunca habilita Pixel, WhatsApp, Venda ou Notificação.
- Usa credenciais do servidor sem devolvê-las ao browser e registra custo/auditoria.
- Respostas reais continuam efêmeras; nenhum contato é alterado.

## Frontend

- Painel lateral com aparência de conversa, composer, Reiniciar e Fechar.
- Destacar nó ativo e caminho visitado no canvas sem marcar o fluxo como alterado.
- Avançado: JSON inicial, saídas simuladas de Integração/IA e toggle real.
- Erro mostra bloco e explicação; clicar centraliza o canvas.
- Responsivo: em 390 px o painel ocupa a tela; em desktop usa lateral redimensionável.

## Limites

- Máximo 200 passos e 100 mensagens por sessão.
- Expiração encerra com opção de reiniciar.
- Definição é validada antes de iniciar; erros estruturais bloqueiam.

## Testes e aceite

- Motor puro para menu, espera, condição, delay, salto e término.
- Provar que adapters padrão não escrevem em banco/outbox.
- Isolamento das sessões e expiração.
- Aceite: percorrer o FUNIL-01 inteiro digitando respostas, sem mensagem real e sem salvar versão.
