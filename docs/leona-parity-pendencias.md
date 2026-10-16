# Pendências pequenas — paridade Leona

Achados da revisão da branch `feat/leona-parity` (15/10/2026) deixados para depois. Nenhum bloqueia uso; todos são baratos.

| # | Onde | Problema | Correção sugerida |
|---|---|---|---|
| 1 | `apps/runtime/src/automation/integration.ts` | `integration.error` de uma falha anterior continua no contexto depois de uma nova tentativa com sucesso; uma Condicional sobre o erro vê a falha velha. | No sucesso, remover `integration.error` do contexto. |
| 2 | `automation-engine.service.ts`, caso `ai` | Recusa ou resposta vazia da OpenAI não registra tokens: consumo subcontado. | `callOpenAi` devolver `tokens` também na falha e gravar `usageRecord` antes do `fail`. |
| 3 | `apps/runtime/src/automation/ai-call.ts` | Mensagem de timeout diz "60 segundos" fixo. | Interpolar o valor da constante de timeout. |
| 4 | `apps/web/src/features/settings/SettingsPage.tsx` (AiKeyPanel) | "Remover chave" usa `void remove.mutateAsync()`: erro (ex.: sem permissão) vira rejeição não tratada, nada aparece na tela. | Usar `remove.mutate()` e exibir `remove.error`, como no salvar. |
| 5 | `apps/api/src/modules/workspaces/routes.ts` (PATCH `/v1/workspace`) | `omit` por rota duplica o `omit` global de `openaiApiKeyEncrypted`. | Remover o `omit` local. |
| 6 | `apps/web/src/features/playbooks/PlaybookEditorPage.tsx` | `NODE_PORTS` copiado à mão, embora `packages/contracts/src/ports.ts` não dependa de zod. | Importar de `ports.ts` direto (ou incluir junto quando a spec B adicionar `reply`/`timeout`). |

Já tratados nesta rodada: checagem de canal antes do envio automático da IA, timeout da Integração de volta a 30 s, limpeza de mídia também na inicialização, mídia não é baixada de novo em mensagem repetida.
