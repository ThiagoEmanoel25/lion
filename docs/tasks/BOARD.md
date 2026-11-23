# Quadro de tasks

Regra: uma task só vira `feita` com **prova** (comando + resultado, ou print) rodada pelo orquestrador, não pelo relatório do subagent. Detalhe técnico vai no prompt do subagent; aqui só o essencial. Contexto das lacunas: `../REVISAO.md`.

## Fase 1 (frontend): todas feitas
Prova: typecheck 0 erros, 527 testes unitários, `npm run test:e2e` = 10 passed, 33 prints em `e2e/screenshots/`.

| # | Task | Status |
|---|---|---|
| 00 | Revisão do projeto (`docs/REVISAO.md`) | feita |
| 01 | Marca Zuno Flow (texto visível) | feita |
| 02 | Base de design e UX | feita |
| 03 | Onboarding | feita |
| 04 | Polimento das telas | feita |
| 05 | E2E e prints | feita |

## Fase 2 (segurança): pendente

| # | Task | Prioridade | Prova exigida para marcar `feita` | Status |
|---|---|---|---|---|
| 10 | Rate limit e lockout em login, refresh e convite (`auth/routes.ts`, `workspaces/routes.ts`) | P0 | Teste de API: N+1 logins errados dá 429; login certo volta após a janela | feita (prova: 5 testes, lockout real com Redis, E2E 10/10) |
| 11 | Webhook Meta falha fechado em produção; HMAC sobre corpo bruto (`webhooks/routes.ts:46`) | P0 | Testes: assinatura válida passa, inválida 401, ausente em produção recusa | feita (prova: 11 testes, 6 novos; diff revisado) |
| 12 | Corrigir `npm audit`; STATUS.md com número real | P0 | `npm audit --omit=dev` sem high/critical; testes e build verdes | feita (prova: audit 6 → 0 após a 21; testes, build, E2E 10/10) |
| 13 | Backup e restore do Postgres (scripts + doc) | P0 | Em container temporário: backup, apagar, restaurar, login e contatos voltam | feita (prova: backup→apagar→restore, contagens iguais) |
| 14 | Headers de segurança (helmet + Nginx) e TLS | P1 | `curl -I` mostra os headers; `nginx -t`; E2E sem erro de CSP | feita (prova: nginx -t, headers via HTTPS e proxy, CORS ok, E2E 10/10); CSP só Report-Only |
| 15 | Assets: lista de MIME permitidos, download seguro | P1 | Teste: HTML/SVG não executa na origem da API | feita (prova: 7 testes de assets, suíte 230/158/54/103, E2E 10/10) |
| 16 | Testes de isolamento entre workspaces | P1 | Suíte nova verde com 2 workspaces; falhas achadas, corrigidas | feita (prova: 126 testes de isolamento com banco real; 3 falhas reais corrigidas; mutação derruba o teste) |
| 17 | Refresh: detectar reuso; escolher workspace no login | P1 | Teste: reuso derruba a sessão | feita (prova: reuso de refresh revoga a cadeia, migração desde zero, E2E 10/10); sem UI de escolha de workspace |
| 18 | CI: `npm audit`, lint mínimo, cobertura, Dependabot | P1 | Workflow válido (`actionlint`); `npm run lint` passa | feita (prova: lint 0 erros, actionlint, audit critical exit 0, cobertura);  |
| 19 | Deploy: backup antes de migrar e rollback (depende da 13) | P1 | Simulação com rollback ao falhar o health; nenhum deploy real | feita (prova: shellcheck, actionlint, simulação com rollback ao falhar o health); bug do SHA anterior achado por mim e corrigido |
| 20 | Config e seed fail-closed; CORS | P2 | Teste: API não sobe sem segredos em produção; seed recusa em produção | feita (prova: 15 testes; produção com env ruim sai com 1 e lista as variáveis; env bom sobe; seed recusa em produção) |
| 21 | Migrar zod 3→4 (fecha o risco aceito da 12; ~125 usos em contracts/config) | P1 | `npm audit --omit=dev` = 0 high; typecheck, testes e E2E verdes | feita (prova: audit 0 vulnerabilidades, zod único 4.6.7, 126 testes de isolamento, 422 com o mesmo formato, E2E 10/10) |

Ondas: 1 = 16-A, 17, 18, 19; 2 = 16-B, 16-C, 20; 3 = 21 (zod, sozinha). 16-A: helper + contacts, inbox, kanban, channels, channel-flow-settings; 16-B: playbooks, assets, knowledge, ai, imports, pixels; 16-C: broadcasts, analytics, billing, operational-settings, webhooks, workspaces (auth fica na 17).

## Fase 2b: bugs achados na caça de 2026-11-23 (H2 = API/runtime; H1 = interface, concluído)
Verificado por mim: 18 arquivos `*.flow.test.ts` em `apps/api/src/modules/*`; com banco real, 31 testes falham hoje, e cada um reproduz um bug. Corrigir = o teste correspondente passa, sem regressão (suíte, 126 de isolamento, lint, typecheck).

| # | Bugs (ids H2) | Gravidade | Onda | Status |
|---|---|---|---|---|
| B-A | Runtime: mensagem de grupo vira contato e o bot responde (46); fluxo por palavra-chave dispara em conversa HUMAN (50); erro de banco perde o lote (48); canal reconectando marca destinatário SKIPPED (49); outbox esgotado deixa mensagem QUEUED para sempre (51); duas réplicas duplicam o envio (52); `renewTimer` sem catch; telefone canônico (util em `packages/domain`) | P0/P1 | 1 | feita (prova: inbox.runtime.flow 9/9 em 3 rodadas; revertendo as correções 7 falham; util de telefone 18 testes; isolamento 126). Teste só roda de dentro de apps/api |
| B-C | API robustez: erros do Fastify viram 500 (JSON inválido, 413, 415) (15-18, 53, 54); PATCH reseta campos por causa do zod 4 `.partial()` (37, 38, 39); fila duplicada e canal duplicado dão 500 (21, 40, 41); fuso inválido (20); ids repetidos (34) | P1 | 1 | feita (prova: health 6/6, workspaces 8/8, channels 6/6, op-settings 3/3; reversão de errors.ts derruba 4 testes; 422 com o mesmo formato) |
| B-D | Disparos, kanban, analytics, playbooks: público sem filtro dispara para toda a base (10); retomar ignora intervalo e cota (08); progresso (09); posição de coluna (22); aviso ao excluir coluna usada (24); execuções simultâneas (25); evento de cancelamento sem consumidor (26); outcomeRate >100% (44); fuso do gráfico diário (45) | P1/P2 | 1 | feita (prova: broadcasts 6/6, kanban 4/4, analytics 3/3, playbooks 5/5 em 3 rodadas; reversão de H2-08 e H2-44 derruba os testes) |
| B-B | Contatos, inbox, webhooks: telefone em formatos diferentes duplica contato (02, 11, 28); PATCH apaga e-mail (01); reimportar CSV reseta etapa e etiquetas (07); telefone só com letras (03); `/assign` não muda o modo (12); cota de contatos ignorada no inbox e no webhook (43, 29); reenvio com a mesma Idempotency-Key perde o lead (27) | P0/P1 | 2 (usa o util de telefone da B-A) | feita (prova: contacts 13/13, inbox 9/9, webhooks 6/6; reversão de H2-01 e H2-27 derruba os testes; script normalize-phones em dry-run) |
| B-E | IA e conhecimento: chave OpenAI do workspace não vale para o nó agente (33); fontes `file` e `url` sempre FAILED (35, 36); horário de atendimento gravado mas nunca aplicado | P1 | 2 | feita (prova: ai 5/5, knowledge 4/4, horário 5/5; reversões de H2-33 e da janela de 12 h derrubam os testes; runtime flow 9/9 em 6 rodadas; build da raiz ok) |
| UI-1 | Contatos, inbox, login, rotas: criar contato com campo vazio falha por enviar `null` (H1-02); erros por linha do CSV descartados (H1-07); sem UI para criar etiquetas nem exportar contatos (H1-10); campos personalizados como JSON cru (H1-21); botão "Criar chat" invisível (H1-06); agendar envia na hora (H1-18); login vem preenchido com a senha de seed (H1-14); rota inexistente fica em branco, sem 404 (H1-15) | P0/P1 | 3 (após API) | feita (prova: 30 specs ui1 passam em desktop e mobile; E2E completo 78/78; prints de contatos com consentimento, etiquetas e campos personalizados) |
| UI-2 | Editor de fluxos: não republica depois de recarregar, `dirty` marcado em qualquer mudança de nó (H1-04); paleta só arrasta, sem clique/teclado/toque (H1-11); menu sem Duplicar/Exportar e `window.prompt` nativo (H1-12); erro de DOM `div` em `p` (H1-19); timestamp ISO no simulador (H1-22); marca Leona nos textos (H1-17) | P0/P1 | 3 | feita (prova: 10 specs ui2 passam; reintroduzindo o bug de `dirty` o spec de republicar falha e os outros 4 passam) |
| UI-3 | Configurações, disparos, agentes, kanban, cobranças, conexões: erros de formulário sem feedback e `pageerror` (H1-05); botão "Criar como rascunho" invisível (H1-06); "Defina OPENAI_API_KEY no ambiente" mostrado ao cliente (H1-13); textos em inglês (cards, PENDING, qualification, QUALIFIED, active, auditoria) (H1-16); "Aguardando o runtime…" sem fim, título e idioma/fuso livres (H1-20); layout (H1-23) | P1/P2 | 3 | feita (prova: 26 specs ui3 passam; kanban com adicionar/mover/remover cartão, disparo com `allContacts` e consentimento) |
| B-G | Novas rotas de API que a interface exige: criar cartão de kanban (H1-09); consentimento do contato para disparos, com campo e importação (H1-03, sem ele nenhum disparo tem público) | P0 | 3 (após B-B e B-D) | feita (prova: migração do zero; consent.flow 7, consent.isolation 5, cartões 3+5; isolamento 136; mutações derrubam os testes de cartão duplicado e de opt-out). UI ainda não usa as rotas |
| PAG-0 | Cobrança desligada no piloto: tirar da interface os botões de checkout/portal/plano que dão 503 e mostrar aviso claro; código do gateway comentado | P1 | 3 | feita (prova: spec pag0 passa em desktop e mobile; sem botão de checkout/portal e sem requisição a eles) |

## Fase 4: piloto, primeira leva (cadastro por convite)

| # | Task | Classe | Etapa | Prova exigida | Status |
|---|---|---|---|---|---|
| P-1 | API e scripts do operador: consultar convite (`GET /v1/invitations/:token`), redefinir senha por token, trocar senha, editar nome; `scripts/operator.mjs` (criar workspace + dono + link, gerar link de redefinição) | BLOQUEIA | 1 | Testes com banco real; ciclo real: operador cria cliente, dono aceita, redefinição revoga sessões; migração do zero | feita (prova: migração do zero; 12 testes novos; isolamento 138; fluxos 126; ciclo real operador→aceite→login→reset→sessão antiga 401; token só em hash; reversão da revogação de sessões derruba o teste) |
| P-2 | Telas: aceitar convite, redefinir senha, perfil; E2E da jornada do piloto | BLOQUEIA | 2 (após P-1) | E2E Playwright desktop e mobile com prints: operador cria o cliente, dono abre o link, define a senha, vê o onboarding, troca a senha, o operador redefine | em andamento |

## Fase 3: funcionalidades que faltam para o MVP (nenhuma iniciada)
Fonte: análise de lacunas de 2026-11-23, com os pontos principais conferidos no código (sem signup, sem redefinição de senha, sem provedor de e-mail, checkout 503, sem DELETE de contato, sem termos/privacidade). Dependem de decisão do dono: gateway de pagamento e planos, provedor e domínio de e-mail, número de WhatsApp de teste, jurídico (termos e LGPD), signup aberto ou por convite, domínio de produção e suporte.

| # | Task | Classe | Esforço | Prova exigida |
|---|---|---|---|---|
| F-01 | Adaptador de e-mail (provedor trocável) e e-mail de convite; o link manual segue como fallback | BLOQUEADO (sem provedor) | M | Teste com provedor falso; e-mail real numa caixa de teste |
| F-02 | Cadastro por convite: tela "Aceitar convite" (hoje só existe a rota da API) e script do operador que cria workspace + dono + link de convite | BLOQUEIA | M | E2E: operador cria o cliente, o dono abre o link, define a senha e vê o dashboard vazio |
| F-03 | Esqueci/redefinir senha e verificação de e-mail (precisam de e-mail). No piloto: o operador gera um link de redefinição por script | BLOQUEADO (sem provedor); script do operador BLOQUEIA | M | Testes: token reutilizado e expirado recusados |
| F-04 | Perfil: trocar nome e senha (exige a senha atual) | BLOQUEIA | P | Teste de API e prints desktop e mobile |
| F-05 | Termos e privacidade (páginas públicas); exportar e excluir/anonimizar contato (LGPD) | BLOQUEIA | M | Testes de API; E2E: excluir contato e a exportação sai |
| F-06 | Cobrança: checkout, portal, webhook assinado e idempotente, troca de plano | DEPOIS (fora do piloto) | G | Gateway em modo teste: assinar, plano muda, cancelar |
| F-07 | Cotas de mensagens e de IA, com aviso no limite | IMPORTANTE | P | Teste: estourar a cota devolve 402/403 |
| F-08 | Alerta de canal desconectado (e-mail e banner) e cron do backup | BLOQUEIA | P/M | Simular queda: alerta enviado; timer ativo e `OK:` do dia no log |
| F-09 | E2E com número real: 24h de conexão, reconexão forçada, mídia nos dois sentidos | BLOQUEIA | M | Relatório com taxas medidas e prints |
| F-10 | E2E completo da jornada: cadastro, conectar canal, publicar fluxo, atender | BLOQUEIA | M | Playwright verde em desktop e mobile, com prints |
| F-11 | Landing Zuno Flow (marca, preço, CTA para o signup), domínio e TLS | BLOQUEIA | M | Prints da landing e `curl -I` com headers |
| F-12 | Notificações na inbox (título da aba, som) e ErrorBoundary | IMPORTANTE | M | Teste de componente e print |
| F-13 | Anexo de mídia na inbox; retrieval vetorial; UI por papel; exportar contatos/conversas em CSV; ajuda e tutoriais; Sentry; página de status | IMPORTANTE | M cada | Definir a prova ao quebrar em tasks |
| F-14 | Meta Cloud API oficial (templates, janela de 24h), Meta Ads, busca global | DEPOIS | G | n/a |

Ordem sugerida para o piloto: F-02, F-04, F-05, F-08, F-09, F-10, F-11 (F-01, F-03 e F-06 dependem de decisões ou ficam para depois).

## Decisões de produto
- Tenant por e-mail (2026-11-23): um e-mail pertence a uma única conta e a um único tenant. Logo: o 409 `USER_EXISTS` do convite é by design (aceito, não é bug); NÃO há UI de escolha de workspace; o login mantém `workspaceId` opcional só por compatibilidade.

- Pagamento (2026-11-23): fora do piloto. Cobrança/checkout/portal ficam desligados (a API continua devolvendo 503 e o código do gateway fica comentado, sem integração). F-06 vira DEPOIS.
- E-mail transacional (2026-11-23): ainda não há provedor nem domínio de envio. O convite continua por link manual (`delivery:'manual'`); F-01 e a redefinição de senha por e-mail (F-03) ficam bloqueados por essa decisão.
- Canal (2026-11-23): o piloto roda só em Baileys (risco de bloqueio aceito); a Meta Cloud API oficial fica para depois (F-14). Quem fornece o número de teste: não definido.
- Cadastro (2026-11-23): por convite no início (sem signup aberto). Faltam a tela de aceitar convite e um jeito de o operador criar o workspace do cliente (F-02 reformulada).

- Grupos de WhatsApp (2026-11-23): confirmado, o bot NÃO responde em grupos (sem opção de configuração).
- Piloto, primeira leva (2026-11-23): desbloquear o piloto com aceitar convite, script do operador, redefinição de senha pelo operador e perfil. Termos de uso e aceite no cadastro ficam para quando houver texto jurídico.

## Riscos aceitos

- Assets (task 15): o upload agora recusa (415) tipos fora da lista, ex.: zip, rar, vcf, json, xml e áudios incomuns (amr, aiff, flac). Decisão de produto: ampliar a lista se esses envios forem necessários (2026-11-22).
- Auth (task 17): cache de membership em `authenticate` NÃO implementado (a revogação hoje é imediata; cache em memória não invalida entre instâncias). 
- Lint (task 18): `no-floating-promises` em warn (22 casos legados, quase todos no web); subir para error depois de corrigi-los.
- Isolamento (16-B): importar fluxo compartilhado só AVISA sobre `nexo-asset://` do dono; limpar a referência derruba a rota com 500 porque o schema `HttpsUrlSchema` (packages/contracts) lança em URL vazia. Corrigir o schema depois.
- Lint: 44 avisos (0 erros); parte são `eslint-disable` sem efeito.
- zod 4 (task 21): o TEXTO das mensagens de validação em `fieldErrors` mudou (ex.: 'Required' -> 'Invalid input: expected string, received undefined'); o formato do 422 é o mesmo e o frontend não lê esses textos.
- CI: gate do `npm audit` agora em `high` (zero vulnerabilidades hoje).
- Runtime (B-A): conversas criadas por disparo nascem em modo HUMAN, então quem responde a um disparo cai para atendente e não para o bot (fluxo por mensagem só roda em modo AI). Grupos de WhatsApp: o bot NÃO responde (sem opção de configuração). `@lid` sem telefone é ignorado. Confirmar com o dono.
- Interface (H1): sem tela de cadastro, de aceite de convite e de esqueci a senha (vira F-02/F-03, não é bug); não exercitado: QR/pareamento do WhatsApp, indexação de conhecimento, envio real e execução de fluxos/disparos (exige runtime e número reais, ver F-09).
- Disparos (B-D): criar disparo sem filtro agora exige `audience.allContacts:true` (422 `AUDIENCE_FILTER_REQUIRED`); `progress` ganhou `skipped`; excluir coluna usada por fluxo publicado dá 409. A UI de disparos (UI-3) precisa do `allContacts` e do `skipped`.
- Testes de fluxo/isolamento compartilham o Redis do rate limit: rodar várias vezes seguidas na mesma janela dá 429 falso (ex.: importação por código). Limpar as chaves no setup do helper (dívida de teste).
- Dado legado (B-B): telefones antigos sem `+` só se corrigem com `scripts/normalize-phones.mjs --apply` (duplicatas e inválidos ficam para revisão manual).
- Consentimento (B-G): opt-out (SAIR/PARAR) nunca volta a ser elegível sem `reconsent:true` explícito (409 `CONTACT_OPTED_OUT`); o CSV nunca desfaz opt-out. O consentimento guarda quando, origem e quem registrou (LGPD). Rotas novas: `POST /v1/kanban/boards/:boardId/cards`, `DELETE /v1/kanban/cards/:cardId`, `POST /v1/contacts/consent`, `consent` em POST/PATCH de contato e coluna `consentimento` no CSV: as telas (UI-1, UI-3) precisam usá-las.
- Horário de atendimento (B-E), suposições a confirmar: sem `outsideMessage` ou sem horário salvo não envia nada; o aviso sai em qualquer modo (inclusive atendimento humano) e não pausa fluxos nem a IA; abertura inclusiva e fechamento exclusivo; faixa com fechamento antes da abertura cruza a meia-noite; fuso inválido conta como aberto; janela de 12 h por conversa; todos os dias desligados = sempre fechado.
- Conhecimento (B-E): só arquivos de texto (txt, md, csv, json); URL, PDF e Office são recusados com 422 (buscar URL no servidor exige proteção contra SSRF, vira F-13).
- Estado da API: 116 testes de fluxo e 136 de isolamento verdes; 0 bugs H2 abertos.
- Interface: E2E completo com banco real = 78 de 78 (existente 10 + ui1 30 + ui2 10 + ui3 26 + pag0 2). Pendências de polimento: o nó adicionado por clique na paleta cai no canto e cobre o minimapa; no mobile o editor de fluxos não mostra "Alterações não salvas"; não há seleção múltipla nem ação em lote de consentimento na lista de contatos (a rota `POST /v1/contacts/consent` fica sem uso); não há exportar contatos nem Duplicar/Exportar fluxo (faltam as rotas na API); toasts transbordam à direita no mobile e o cabeçalho do chat fica apertado; `shared/api/client.ts` descarta o corpo dos erros 422 (UI-1 fez `fetch` próprio na importação de CSV).
- Auth (P-1): o access token (JWT de 15 min) de sessões revogadas segue válido até expirar; só o refresh é cortado. O accept distingue 404/410/409 (o GET do convite é genérico). `GET /v1/auth/me` NÃO vaza a chave OpenAI cifrada (conferido: há um `omit` global no Prisma; só `openaiApiKeyLast4` sai).
