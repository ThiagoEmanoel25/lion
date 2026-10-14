# Leona — Funções Principais & Oportunidades de Produto

_Data: 2026-10-13 · Baseado na análise do bundle de produção (`app.leonasolutions.io`)_

## Visão geral

A Leona é uma plataforma de automação de atendimento e vendas via WhatsApp: inbox multiatendente, agentes de IA, construtor visual de flows, CRM, campanhas Meta e cobrança/NF em um só lugar. Serve operações que vendem e dão suporte por WhatsApp — e-commerce, infoprodutos e serviços — que querem escalar atendimento sem contratar proporcionalmente.

**Stack percebida** (pelo bundle de produção): front-end **React + Vite** (SPA, com SRI nos assets) e uma **API Rails** em `apiaws.leonasolutions.io/api/v1` — rotas em snake_case, filas Sidekiq, tempo real via ActionCable, Redis, RDS e Supabase para buffer de webhooks. IA plugada em OpenAI, Anthropic (Claude), Google (Gemini) e ElevenLabs.

## Funções principais

A Leona cobre a jornada inteira — do primeiro contato no WhatsApp até o pagamento e a nota fiscal.

- **Atendimento (inbox multiatendente)** — caixa de entrada compartilhada com departamentos, horário de funcionamento, respostas rápidas, etiquetas, campos personalizados de cliente e acesso de suporte controlado.
- **Agentes de IA** — agentes conversacionais que atendem sozinhos, com múltiplos provedores (Claude 3.5 Sonnet / Sonnet 4, Gemini 2.5–3.x, ElevenLabs para voz) e credenciais MCP para dar ferramentas ao agente.
- **Flows (automação visual)** — construtor arrasta-e-solta com nós de envio (texto, imagem, áudio, figurinha), condição, delay/espera, menu, botões, lista, captura de entrada, chamada de agente de IA, webhook, atribuição e etiquetagem — apoiado por variáveis globais e tradução de flows.
- **CRM e organização** — cadastro de contatos/clientes, produtos, campos personalizados e etiquetas, servindo de base para segmentação e disparo.
- **Campanhas Meta/Facebook** — integração de campanhas, Pixel, perfis, templates oficiais de WhatsApp e Embedded Signup da Meta para conectar contas.
- **Pagamentos e faturamento** — cobrança via Pagar.me e LeonaPay dentro do flow, mais billing próprio (faturas, reembolsos) para a assinatura da plataforma.
- **Nota fiscal** — emissão integrada via NF-issuer e integrações de invoice, fechando o ciclo pós-venda.

## Integrações

| Integração | Para quê | Observação |
| --- | --- | --- |
| IA — OpenAI / Anthropic / Google / ElevenLabs | Agentes e geração de conteúdo; ElevenLabs para voz/áudio | Chaves ficam por conta do cliente (não hardcoded) |
| LeonaPay / Pagar.me | Cobrança dentro do flow (PIX, cartão) | `pk_...` tokeniza no browser, `sk_...` só no backend |
| Zenith | Integração externa (OAuth connect/callback) | `app.zenithworld.com.br` |
| Utmify | Envio de vendas / rastreamento de UTM | `docs.utmify.com.br` |
| NF-issuer / invoice | Emissão de nota fiscal | `notasy.com.br` |
| Webhooks de entrada | Receber eventos de sistemas externos no flow | `/settings/inbound-webhooks` |
| MCP credentials | Dar ferramentas aos agentes de IA via MCP | `/settings/mcp-credentials` |
| Meta Embedded Signup | Conectar conta WhatsApp Business sem sair do app | App IDs públicos por design |

## Área administrativa & operação

Existe um painel admin interno robusto, focado em operar a plataforma como SaaS:

- **Saúde de infra** — health checks de Redis (flow execution, Sidekiq, webhook buffer), RDS, web, Supabase webhook logs, ActionCable e webhook ingestor.
- **Custos de IA** — `cost_overview` e `leona_ai/cost_logs` para acompanhar gasto por provedor/pacote.
- **Traduções de flow** — overview, locales, runs, usage e settings para localizar flows.
- **Billing/config** — `billing_configs`, pacotes de IA, settings de secrets por módulo.
- **Convites e usuários** — `account_invitations`, criação de usuário + convite, servidores, banners e anúncios.

## Oportunidades de melhoria

Priorizadas por impacto × esforço.

### Segurança (fazer primeiro)
1. **Garantir autorização server-side em todas as rotas `/admin/*`.** O bundle público expõe as ~124 rotas, inclusive `/admin/leona_ai/secrets` e `/admin/flow_translations/secrets`. O gating client-side (`role==="admin"`) é só cosmético — o que protege é o 403 no servidor. Vale um teste automatizado logando como usuário comum.
2. **Revisar exposição de health/cost endpoints** — `*_health`, `cost_overview` não devem vazar topologia ou números pra não-admin.

### UX / onboarding
3. **Reduzir o tempo até o primeiro flow rodando.** Onboarding guiado (template de flow pronto por nicho: e-commerce, infoproduto, agendamento) encurta o "aha moment".
4. **Observabilidade de flow pro cliente** — um painel de "por que o flow parou aqui" (logs de execução legíveis) reduz ticket de suporte.

### Monetização
5. **Empacotar IA por consumo com teto visível.** Já existe `cost_logs` e `packages` no admin — expor isso ao cliente (saldo/consumo de IA em tempo real) abre upsell e evita surpresa na fatura.
6. **Marketplace de templates de flow/agente** — comunidade cria, você monetiza o melhor; aumenta retenção.

### Plataforma / escala
7. **API pública documentada + MCP** — já há `mcp-credentials` e webhooks; formalizar como API pública abre integrações de terceiros e reduz pedidos custom.
8. **Versionamento e staging de flows** — permitir testar uma versão de flow antes de publicar reduz risco em operações grandes.

## Anexo: auditoria de exposição client-side

Varredura do bundle de produção (`index-CKd6cI9N.js`, 5,8 MB):

**OK:**
- Nenhum segredo hardcoded (tokens/secrets são todos input de runtime do usuário).
- SRI (`integrity=sha384`) ativo nos assets.
- Sem source map vazado, sem Sentry DSN, sem chave Google/AWS.
- Meta/WhatsApp App IDs no bundle são públicos por design.

**Ponto de atenção (único):**
- Toda a superfície de API admin é enumerável pelo JS público (normal em SPA). O risco real depende 100% da autorização server-side — ver item 1 das melhorias. **Não testado** por requerer requisição autenticada ao backend (escopo de teste ativo).
