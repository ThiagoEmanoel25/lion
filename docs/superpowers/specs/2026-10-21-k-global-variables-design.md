# K — Variáveis globais do workspace

Data: 21/10/2026  
Roadmap: item 1.4.

## Objetivo

Centralizar valores usados em vários fluxos — links, chaves PIX e textos institucionais — e disponibilizá-los como `{{global.nome}}`.

## Dados e segurança

`GlobalVariable`:

- `id`, `workspaceId`, `name`, `normalizedName`, `valueEncrypted`, `valueLast4?`, `sensitive`, timestamps;
- nome único por workspace, de 2 a 60 caracteres, iniciado por letra e contendo apenas `[a-z0-9_]`;
- valor de até 8 KB;
- todo valor é cifrado com o mecanismo já usado para a chave OpenAI;
- variáveis sensíveis nunca voltam pela API, nem em logs, auditoria ou simulação do frontend.

## API

- `GET /v1/global-variables`: metadados e valor apenas quando `sensitive=false`.
- `POST`, `PATCH`, `DELETE`: `workspace.manage`.
- Alterar `sensitive` para falso exige reenviar o valor; não descriptografar e devolver segredo antigo.
- Exclusão permitida, mas retorna contagem de versões ativas que parecem referenciá-la para confirmação da UI.

## Runtime

- No início e em cada retomada, carregar as variáveis do workspace e injetar `context.global`.
- O banco é a fonte atual; uma execução retomada enxerga o valor mais recente.
- Interpolação ausente preserva o comportamento atual e gera string vazia somente onde o renderer já faz isso.
- Nunca persistir variáveis sensíveis no `Execution.context`; resolver segredos apenas no momento de renderizar.
- Campos de diagnóstico mostram nome e resolução bem-sucedida, nunca o valor sensível.

## Editor

- Aba Configurações → **Variáveis globais**, com CRUD, mascaramento e ação “Trocar valor”.
- Seletor `<>` ganha grupo **Globais** em todos os editores de texto.
- Variável sensível aparece como `global.nome` com ícone de cadeado.
- Simulação permite sobrescrever apenas variáveis não sensíveis; segredos reais exigem “executar de verdade” e permissão.

## Importador

- Variáveis Leona não resolvidas entram no relatório com sugestão de global.
- `link_grupo` e similares não são criadas automaticamente sem valor.
- Conversão de `{g_nome}` para `{{global.nome}}` quando o export declarar origem global.

## Testes e aceite

- Criptografia, mascaramento, nomes inválidos e isolamento.
- Interpolação sem persistir segredo no contexto.
- Seletor lista globais e insere sintaxe correta.
- Aceite: atualizar `global.link_grupo` uma vez e todas as novas mensagens que usam `{{global.link_grupo}}` enviarem o valor novo.
