# Arquitetura de Produto — Plataforma de Vendas e Atendimento com IA no WhatsApp

_Versão 0.1 · 2026-10-13 · Documento de decisão para MVP_

## 1. Resumo executivo

Construir um SaaS B2B que ajuda pequenas e médias operações a vender e atender pelo WhatsApp com uma equipe híbrida: agentes humanos e agentes de IA. O produto combina inbox compartilhada, automações, CRM leve e acompanhamento claro das conversas e dos resultados.

O diferencial inicial não será ter o maior número de funções. Será colocar uma automação útil no ar rapidamente, mostrar por que cada conversa avançou ou parou e permitir que um humano assuma o atendimento sem perder contexto.

**Promessa:** conectar o WhatsApp, escolher um playbook do negócio e colocar um agente em produção no mesmo dia.

**Recorte recomendado para o lançamento:** negócios de serviços que vendem por conversa e agendamento — clínicas, estética, imobiliárias, educação e serviços locais. Esse público tem jornada clara, alto valor por lead e menor complexidade operacional do que e-commerce.

## 2. Problema e tese

### Problemas do cliente

- Leads demoram a receber resposta e esfriam.
- Conversas se perdem entre atendentes e aparelhos.
- A equipe responde repetidamente às mesmas perguntas.
- Automações quebram sem explicar o motivo.
- O gestor não sabe quais conversas geram agendamentos e vendas.
- Ferramentas existentes exigem implantação técnica ou acumulam funções demais.

### Tese do produto

Uma camada de automação conversacional só gera valor quando três coisas funcionam juntas:

1. a IA conhece o negócio e respeita limites claros;
2. o humano assume exceções com contexto completo;
3. o gestor enxerga execução, conversão, custo e falhas.

Por isso, a unidade central do produto não será apenas a mensagem. Será a **jornada do contato**, da origem do lead até o desfecho comercial.

## 3. Público-alvo e posicionamento

### ICP inicial

- Empresas com 3 a 30 pessoas em atendimento/vendas.
- Entre 1.000 e 30.000 conversas mensais.
- WhatsApp como canal principal de aquisição, qualificação ou agendamento.
- Gestor sente perda de leads, baixa rastreabilidade e custo crescente de equipe.
- Processo comercial repetível, mas ainda operado manualmente.

### Usuários

| Perfil | Objetivo principal |
| --- | --- |
| Dono/gestor | Aumentar conversão e acompanhar operação/custo |
| Supervisor | Distribuir conversas, revisar falhas e melhorar playbooks |
| Atendente/vendedor | Responder rápido e assumir casos complexos |
| Implementador/agência | Configurar contas, templates e integrações |

### Posicionamento

> A central de vendas no WhatsApp que combina IA e equipe humana, entra em operação em horas e explica cada decisão da automação.

Não competir no início como CRM completo, plataforma omnichannel ou construtor genérico de automações.

## 4. Escopo do MVP

### Deve existir no MVP

1. **Conta e equipe**
   - organização multi-tenant;
   - usuários, convites e papéis: proprietário, gestor e atendente;
   - departamentos ou filas simples.

2. **Conexão oficial com WhatsApp**
   - WhatsApp Cloud API via Embedded Signup;
   - recebimento de webhooks com idempotência;
   - envio de texto, mídia e templates aprovados;
   - acompanhamento de enviado, entregue, lido e falhou.

3. **Inbox compartilhada**
   - lista de conversas, filtros e busca;
   - atribuição manual e automática;
   - notas internas, etiquetas e respostas rápidas;
   - transferência fluida entre IA e humano;
   - histórico e contexto do contato.

4. **Agente de IA orientado por playbook**
   - objetivo, tom, regras, perguntas de qualificação e critérios de handoff;
   - base de conhecimento com documentos e perguntas frequentes;
   - respostas estruturadas e chamadas de ferramentas controladas;
   - limites de horário, confiança e assuntos proibidos;
   - revisão humana opcional antes de enviar.

5. **Automações essenciais**
   - gatilhos: primeira mensagem, palavra-chave, etiqueta e ausência de resposta;
   - ações: mensagem, condição, espera, atualizar contato, atribuir, chamar IA, webhook e encerrar;
   - templates prontos por nicho;
   - rascunho, versão publicada e histórico de versões.

6. **CRM leve**
   - contatos, estágio do funil, responsável, etiquetas e campos personalizados;
   - linha do tempo unificada;
   - importação CSV com validação.

7. **Observabilidade e resultado**
   - timeline da execução da automação em linguagem legível;
   - motivo de pausa, falha ou transferência;
   - tempo de primeira resposta, volume, handoff, agendamentos/conversões e custo de IA;
   - alertas de webhook, conexão ou orçamento.

8. **Admin e cobrança básica**
   - planos, limites de usuários, números, conversas e IA;
   - uso atual e previsão de excedente;
   - painel operacional separado e protegido.

### Fora do MVP

- Omnichannel além do WhatsApp.
- Emissor de nota fiscal próprio.
- Gateway de pagamento próprio.
- Marketplace aberto.
- Campanhas completas de mídia Meta.
- Editor visual irrestrito com dezenas de tipos de nó.
- Modelos de IA treinados pelo produto.
- Aplicativos móveis nativos.

Esses itens podem entrar depois por integração ou conforme validação comercial.

## 5. Jornadas críticas

### Ativação

1. Criar conta e informar o segmento.
2. Conectar um número oficial do WhatsApp.
3. Importar FAQ/documentos ou preencher um roteiro guiado.
4. Escolher um template de playbook.
5. Testar em um simulador com cenários sugeridos.
6. Publicar para uma parcela das conversas.
7. Ver a primeira conversa concluída e seu resumo.

**Evento de ativação:** primeira conversa real concluída por IA ou com handoff correto em até 24 horas após a conexão.

### Atendimento

1. Mensagem chega e é validada/deduplicada.
2. Política decide entre automação, fila humana ou agente de IA.
3. IA responde usando conhecimento e ferramentas autorizadas.
4. Baixa confiança, intenção sensível ou pedido explícito gera handoff.
5. Atendente recebe resumo, dados coletados e motivo da transferência.
6. Desfecho atualiza estágio e métricas.

### Melhoria contínua

1. Supervisor abre conversas com falha, handoff ou baixa avaliação.
2. Visualiza a execução e evidências usadas pela IA.
3. Corrige fonte, regra ou playbook.
4. Executa casos de teste salvos.
5. Publica nova versão com possibilidade de rollback.

## 6. Arquitetura funcional

```text
Aquisição
  WhatsApp / QR / anúncio / link com UTM
          │
          ▼
Conversação
  Inbox ── Roteador ── Agente IA ── Handoff humano
          │                │
          ▼                ▼
Automação              Conhecimento + ferramentas
  Gatilhos, regras,      FAQ, agenda, CRM, webhook
  esperas e ações
          │
          ▼
Dados e resultado
  Contato ── Jornada ── Conversão ── Métricas/custo
```

### Módulos do produto

- **Workspace:** conta, usuários, papéis, preferências e auditoria.
- **Channels:** conexão, templates, webhooks e status do WhatsApp.
- **Inbox:** conversas, mensagens, filas e colaboração.
- **Contacts:** perfil, campos, consentimento, etiquetas e funil.
- **Automation:** definições, versões, execuções, timers e erros.
- **AI Runtime:** prompts, políticas, ferramentas, memória curta e custo.
- **Knowledge:** fontes, fragmentos, indexação e citações internas.
- **Analytics:** eventos, funis, operação, qualidade e custos.
- **Billing:** planos, cotas, medição e cobrança.
- **Admin:** saúde, suporte, auditoria e configuração interna.

## 7. Arquitetura técnica recomendada

### Princípios

- Começar como **monólito modular**, evitando microserviços prematuros.
- Processamento assíncrono para webhooks, IA, mídia, indexação e timers.
- Eventos de domínio persistidos para auditoria e métricas.
- Isolamento multi-tenant em todas as consultas e políticas.
- Provedores externos atrás de interfaces substituíveis.
- Separar plano de controle (configuração) do plano de execução (mensagens e automações).

### Stack de referência

| Camada | Escolha inicial | Motivo |
| --- | --- | --- |
| Web | Next.js + TypeScript | Produto B2B, ecossistema e velocidade de entrega |
| API | NestJS + TypeScript | Tipagem compartilhada, módulos e workers consistentes |
| Banco transacional | PostgreSQL | Confiabilidade, JSONB, busca e suporte a vetores |
| Fila/cache | Redis + BullMQ | Jobs, retries, locks e agendamentos |
| Tempo real | WebSocket/SSE | Atualização da inbox e status de mensagens |
| Arquivos | S3 compatível | Mídias e documentos com URLs assinadas |
| Busca semântica | pgvector no início | Menor complexidade operacional |
| Analytics | Postgres + agregações no MVP | Migrar eventos para ClickHouse só com volume real |
| Observabilidade | OpenTelemetry + logs estruturados + Sentry | Rastreamento ponta a ponta e erros acionáveis |
| Infra | Containers gerenciados + IaC | Deploy repetível sem operar Kubernetes cedo |

Ruby on Rails também é uma excelente alternativa caso seja a competência dominante da equipe. A decisão deve favorecer velocidade e domínio interno, não imitar a stack analisada.

### Componentes de execução

```text
Meta Webhook
    │
    ▼
Webhook Gateway ── valida assinatura ── persiste evento bruto
    │
    ▼
Fila de ingestão ── deduplica ── normaliza ── cria mensagem
    │
    ├──► Atualização em tempo real da inbox
    │
    └──► Orquestrador de jornada
              │
              ├──► Regras/automação
              ├──► AI Runtime ──► LLM / conhecimento / ferramentas
              └──► Outbox ──► API do WhatsApp
```

### Decisões importantes

- Confirmar o webhook rapidamente; nunca esperar o modelo de IA responder no request da Meta.
- Guardar payload bruto e evento normalizado, com política de retenção.
- Usar chave idempotente por evento externo e por comando de envio.
- Implementar transactional outbox para não perder mensagens entre banco e fila.
- Ordenar processamento por conversa para evitar respostas fora de sequência.
- Tratar cada chamada externa com timeout, retry exponencial, circuit breaker e dead-letter queue.
- Fixar uma versão de playbook em cada execução para garantir reprodutibilidade.
- Salvar a origem de cada informação usada pela IA e nunca expor raciocínio interno do modelo.

## 8. Modelo de dados essencial

Todas as entidades de negócio carregam `workspace_id`, salvo catálogos globais.

| Entidade | Responsabilidade |
| --- | --- |
| Workspace | Tenant, plano e configurações |
| User / Membership / Role | Identidade e autorização |
| Channel | Número e credenciais do WhatsApp |
| Contact / ContactField | Perfil e dados customizados |
| Conversation | Sessão, estado, fila e responsável |
| Message | Conteúdo, direção e status de entrega |
| Tag / ContactTag | Segmentação |
| Pipeline / Stage | Funil comercial leve |
| Playbook / PlaybookVersion | Configuração versionada do agente |
| Automation / AutomationVersion | Grafo/regras publicados |
| Execution / ExecutionStep | Estado e trilha explicável |
| KnowledgeSource / Chunk | Fonte e índice semântico |
| Tool / ToolCredential | Integrações permitidas ao agente |
| Event | Fato de domínio imutável para analytics/auditoria |
| UsageRecord | Tokens, mensagens e custo por provedor |
| Subscription / Invoice | Plano e cobrança |
| AuditLog | Ação administrativa sensível |

### Estados mínimos da conversa

`new → automated → waiting_customer → queued → assigned → resolved`

Transições devem ser explícitas, auditáveis e protegidas contra concorrência.

## 9. IA segura e controlável

### Pipeline de resposta

1. Classificar intenção e risco.
2. Carregar perfil, resumo e últimas mensagens necessárias.
3. Buscar conhecimento permitido ao playbook.
4. Gerar uma resposta ou uma chamada de ferramenta estruturada.
5. Validar política, tamanho, dados sensíveis e confiança.
6. Enviar, pedir aprovação humana ou realizar handoff.
7. Registrar modelo, latência, tokens, custo, versão e fontes.

### Guardrails

- Ferramentas em allowlist e argumentos validados por schema.
- Credenciais criptografadas e nunca inseridas no prompt.
- Limites de gasto por workspace, agente e período.
- Handoff obrigatório em temas regulados, ameaça, reclamação grave ou baixa confiança.
- Detecção de prompt injection em documentos e mensagens.
- Conhecimento isolado por tenant, com testes contra vazamento cruzado.
- Mascaramento de dados sensíveis nos logs.
- Suite de casos de teste por playbook antes da publicação.

### Estratégia de provedores

Começar com um provedor principal e um fallback. Criar uma interface interna por capacidade (`chat`, `embeddings`, `transcription`) e registrar custo normalizado. Não expor ao cliente uma seleção complexa de modelos no MVP; vender resultado e nível de serviço.

## 10. Segurança, privacidade e confiabilidade

- RBAC server-side em toda rota e ação; interface nunca é barreira de segurança.
- Row-level enforcement por `workspace_id`, com testes automatizados de isolamento.
- Segredos em cofre gerenciado, rotação e acesso mínimo.
- Criptografia em trânsito e em repouso.
- Assinatura e validação de webhooks.
- Sessões seguras, MFA para administradores e revogação de dispositivos.
- Auditoria de login, exportação, mudança de papel, publicação e acesso de suporte.
- Acesso de suporte temporário, consentido e registrado.
- Backups testados e procedimentos de restauração.
- Política LGPD: base legal, consentimento quando aplicável, retenção, exportação e exclusão.
- Proteção contra abuso: rate limit, cotas, detecção de loops e bloqueio emergencial por canal.

### Metas iniciais de serviço

- Disponibilidade mensal da ingestão: 99,9%.
- Confirmação de webhook: p95 abaixo de 500 ms.
- Evento visível na inbox: p95 abaixo de 2 s, sem contar indisponibilidade externa.
- RPO: 15 minutos; RTO: 2 horas no lançamento.

## 11. Métricas do produto

### Métrica principal

**Conversas com desfecho útil por workspace por semana.**

Desfecho útil deve ser configurável: lead qualificado, agendamento, venda, suporte resolvido ou handoff correto.

### Funil

- Conta criada → canal conectado.
- Canal conectado → playbook publicado.
- Publicado → primeira conversa concluída.
- Primeira conversa → 20 desfechos úteis.
- Semana 1 → retenção nas semanas 4 e 8.

### Qualidade operacional

- Tempo de primeira resposta.
- Taxa de resolução pela IA.
- Taxa e motivo de handoff.
- Reabertura e correção humana.
- Falhas por etapa e por integração.
- Conversão por origem, playbook e versão.
- Custo de IA por desfecho útil.
- CSAT ou avaliação amostral do gestor.

## 12. Modelo comercial inicial

Cobrar uma assinatura base por workspace, incluindo um número e uma franquia de usuários/conversas. Adicionar excedentes previsíveis de conversa e IA. Evitar margem escondida por token como mensagem principal; o cliente entende melhor volume e resultado.

### Sugestão de pacotes para teste

- **Essencial:** 1 número, até 5 usuários, inbox e automações básicas.
- **Crescimento:** mais usuários, agente de IA, analytics e integrações.
- **Escala:** múltiplos números/equipes, SSO, SLA e controles avançados.

Os preços só devem ser definidos depois de entrevistas e de medir custo real por conversa. A meta financeira é margem bruta acima de 70% depois de WhatsApp, IA e infraestrutura.

## 13. Roadmap de entrega

### Fase 0 — Descoberta (2 semanas)

- Entrevistar 10 a 15 empresas de dois nichos.
- Mapear conversas reais, objeções, regras e desfechos.
- Validar willingness to pay e implantação assistida.
- Escolher um único nicho e um playbook inicial.

**Saída:** problema priorizado, linguagem comercial, casos de teste e 3 design partners.

### Fase 1 — Fundação (3 semanas)

- Multi-tenancy, autenticação, papéis e auditoria.
- Integração oficial com WhatsApp e pipeline idempotente.
- Contatos, conversas e mensagens.
- Observabilidade técnica mínima.

### Fase 2 — Produto utilizável (4 semanas)

- Inbox multiatendente e tempo real.
- Agente de IA com conhecimento e handoff.
- Configurador de playbook guiado.
- Timeline legível e medição de uso/custo.

### Fase 3 — Piloto pago (3 semanas)

- Automações essenciais e templates do nicho.
- Funil/CRM leve e webhooks de saída.
- Billing, cotas e alertas.
- Simulador, testes e versionamento.

### Fase 4 — Consolidação (4 a 8 semanas)

- Melhorias baseadas em dados dos pilotos.
- Agenda e integrações prioritárias.
- Analytics de conversão.
- Onboarding self-service gradual.

**Horizonte realista:** piloto funcional em 10 a 12 semanas com uma equipe experiente de 4 a 6 pessoas; lançamento mais robusto em 4 a 5 meses.

## 14. Equipe mínima

- 1 responsável por produto/fundador com acesso diário aos clientes.
- 2 engenheiros full-stack.
- 1 engenheiro com foco em backend/IA/infra.
- 1 designer de produto compartilhado.
- 1 pessoa de implantação/sucesso desde os pilotos.

No começo, suporte e onboarding são parte da descoberta do produto, não apenas operação.

## 15. Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Dependência da Meta e mudanças de política | API oficial, monitoramento, abstração do canal e comunicação clara |
| Respostas erradas da IA | Escopo estreito, fontes, guardrails, aprovação e handoff |
| Produto genérico demais | Um nicho, um desfecho e templates opinativos no lançamento |
| Custo de IA imprevisível | Medição por execução, limites, cache, modelos por tarefa e alertas |
| Complexidade de implantação | Wizard, template, simulador e implantação assistida inicial |
| Vazamento entre clientes | Tenant enforcement central, testes e auditoria |
| Automação difícil de depurar | Execução versionada e timeline explicável desde o MVP |
| Concorrência por preço | Vender tempo até valor e conversão, não quantidade de features |

## 16. Decisões que precisam de validação

Antes de escrever o backlog definitivo, responder com clientes:

1. Qual nicho tem maior dor, frequência e ticket: clínicas, estética, imobiliárias, educação ou outro?
2. Qual é o primeiro desfecho mensurável: agendamento, qualificação, orçamento ou venda?
3. O cliente aceita usar API oficial e migrar/conectar o número?
4. Quais sistemas precisam de integração já no piloto?
5. Quem configura o agente: cliente, agência ou nossa implantação?
6. Qual grau de autonomia da IA é aceitável no primeiro mês?
7. Qual volume e custo atuais tornam a compra óbvia?

## 17. Próximo passo recomendado

Não começar pelo construtor visual completo. Começar com um **configurador guiado de playbook para um único nicho**, inbox, handoff e timeline de execução. Rodar três pilotos pagos, medir desfecho útil e só então generalizar o motor de automação.

O primeiro pacote vendável pode ser:

> “Em 7 dias conectamos seu WhatsApp, configuramos um agente que qualifica e agenda, treinamos sua equipe para assumir exceções e entregamos um painel mostrando cada lead e resultado.”

Esse formato combina software com implantação assistida, reduz risco de produto e produz os dados necessários para construir o SaaS self-service correto.
