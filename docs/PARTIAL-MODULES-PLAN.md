# Plano de conclusão dos módulos parciais

Data da revisão: 14 de outubro de 2026.

Este plano transforma cada módulo classificado como parcial em uma entrega verificável. Uma tela estática ou um endpoint isolado não contam como módulo concluído: frontend, autorização, persistência, estados de erro e testes precisam funcionar juntos.

## Onda 1 — Operação real

Status: concluída em 14 de outubro de 2026. Validação global aprovada com typecheck, 49 testes e build dos três workspaces.

### Dashboard e resultados

Status: concluído.

- Usar exclusivamente métricas do workspace autenticado.
- Exibir período, série diária, conversas abertas, desfechos, primeira resposta e custo.
- Mostrar conversas que precisam de atenção e desempenho das automações publicadas.
- Tratar carregamento, vazio, erro e atualização periódica.
- Não expor nomes de serviços, topologia ou custos internos de infraestrutura.

### Chats ao vivo

Status: concluído com polling de 8 segundos na lista e 4 segundos no detalhe. SSE/WebSocket permanece como evolução de escala.

- Remover conversas e mensagens demonstrativas da tela operacional.
- Listar, buscar e filtrar conversas reais.
- Abrir histórico, enviar mensagem idempotente e atualizar status.
- Assumir, atribuir, pausar ou devolver a conversa para a automação.
- Exibir execução, passos, falhas e motivo de handoff.
- Usar polling confiável nesta onda; evolução para SSE/WebSocket fica registrada separadamente.

### Contatos e CRM leve

Status: concluído. O Kanban continua corretamente separado deste módulo.

- Listar, buscar e filtrar contatos reais por estágio.
- Criar e editar perfil, estágio e campos personalizados.
- Adicionar e remover etiquetas.
- Importar CSV com validação, deduplicação e relatório de erros.
- Preparar os contratos para o Kanban sem implementar o quadro nesta onda.

## Onda 2 — Inteligência e integrações

Status: concluída em 14 de outubro de 2026.

### Agentes de IA

Status: concluído para o MVP. O adapter OpenAI usa configuração externa; sem chave, o runtime realiza handoff explícito em vez de fabricar resposta.

- CRUD de agentes com objetivo, prompt, tom, limites e política de handoff.
- Credenciais de provedores criptografadas e nunca retornadas pela API.
- Adapter real inicialmente para um provedor, mantendo interface para outros.
- Recuperação da base de conhecimento com isolamento por workspace.
- Medição de tokens/custo, timeout, fallback e handoff explícito.
- Tela de teste antes da publicação e vínculo do agente ao nó do fluxo.

### Webhooks de entrada

Status: concluído com assinatura HMAC, segredo cifrado, idempotência, rate limit, logs e replay.

- Cadastro de endpoints por workspace com segredo rotacionável.
- Assinatura, idempotência, limites de payload e rate limit.
- Mapeamento de payload para variáveis e gatilho de fluxo.
- Logs, tentativas, erro legível e replay auditado.

## Onda 3 — Gestão

Status: concluída em 14 de outubro de 2026, sem simulação de provedor financeiro.

### Configurações

Status: concluído com workspace, equipe, convites, filas, horários e auditoria reais.

- Dados reais do workspace e preferências regionais.
- Equipe, convites, papéis e desativação de acesso.
- Filas/departamentos e horários de atendimento.
- Auditoria paginada e protegida por permissão.
- Separar configuração de canal, operação e segurança em rotas reais.

### Cobranças e assinaturas

Status: concluído para gestão de plano, uso e enforcement. Checkout, faturas e portal permanecem indisponíveis até existir um adapter comercial real.

- Tela de plano, limites, uso atual e previsão de excedente.
- Enforcement server-side das cotas relevantes.
- Histórico de consumo e exportação.
- Adapter do provedor de cobrança somente após definição comercial; nenhuma cobrança simulada será apresentada como real.

## Depois dos módulos parciais

Os itens ausentes permanecem fora destas ondas: Kanban, disparos em massa, Facebook/Meta Ads e tutoriais. Disparos em massa não devem ser implementados sobre Baileys sem política de consentimento, opt-out, frequência e avaliação do risco de bloqueio.

## Critérios globais de conclusão

- Isolamento por `workspaceId` e RBAC no servidor.
- Nenhuma tela operacional alimentada por arrays demonstrativos.
- Estados de loading, vazio, erro e sucesso no frontend.
- Ações idempotentes quando houver retry.
- Typecheck, testes e build aprovados.
- Documentação de API e status atualizada na mesma entrega.
