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

## Da spec B (Aguarda Resposta)

| # | Onde | Problema | Correção sugerida |
|---|---|---|---|
| 7 | `apps/api/src/modules/playbooks/compiler.ts` (`SELF_LOOP`) | Se o export da Leona tiver `timeout` ligando o Aguarda Resposta nele mesmo, o compiler rejeita como erro. | Conferir no export antes da spec D; se houver, liberar `SELF_LOOP` só para `wait_response` pela porta `timeout`. |
| 8 | Importador (spec D) | Conexão sem `port` saindo do Aguarda Resposta aparece em "respondeu" no editor, mas o compiler a rejeita. | O importador sempre grava `port`. |
| 9 | Deploy | API/web publicados antes do runtime: fluxo com Aguarda Resposta falha num runtime antigo. | Publicar o runtime primeiro. |
| 10 | Editor | Campo de tempo não pode ser apagado para redigitar (vira 0); ícone da paleta com fundo claro fixo no modo escuro. | Guardar rascunho em string; usar token de cor. |
