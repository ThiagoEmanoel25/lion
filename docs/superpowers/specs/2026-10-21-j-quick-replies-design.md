# J — Respostas rápidas

Data: 21/10/2026  
Roadmap: item 1.3 · Depende do composer do Inbox.

## Objetivo

Permitir que a equipe cadastre textos reutilizáveis e os insira digitando `/atalho`, como no Leona.

## Dados

`QuickReply`:

- `id`, `workspaceId`, `shortcut`, `body`, `assetId?`, `createdById`, timestamps;
- `shortcutNormalized` único por workspace, sem `/`, de 2 a 40 caracteres, `[a-z0-9_-]`;
- `body` de 1 a 4096 caracteres;
- `assetId` aponta para `PlaybookAsset`, respeitando workspace e limite de 10 MB.

## API e permissões

- `GET /v1/quick-replies?search=`: membros com `conversation.read`.
- `POST /v1/quick-replies`, `PATCH /v1/quick-replies/:id`, `DELETE`: `workspace.manage`.
- Resposta nunca inclui bytes do arquivo; usa a rota autenticada do asset.
- Exclusão não apaga asset compartilhado. Um job de limpeza remove assets órfãos depois da retenção.

## Frontend

- Aba Configurações → **Respostas rápidas** com busca, estado vazio e CRUD.
- Campos: atalho, texto, mídia opcional e pré-visualização.
- No composer, `/` seguido de texto abre lista filtrada por atalho e conteúdo.
- Setas navegam, Enter insere, Esc fecha.
- Inserir não envia automaticamente: o operador pode editar antes.
- A mídia selecionada acompanha o rascunho e só é enviada ao confirmar.

## Regras de UX

- `/pix` encontra `pix`; não diferencia maiúsculas.
- Um espaço antes de `/` também abre; `/` no meio de uma palavra não abre.
- Se o texto do operador continuar depois do atalho, substituir somente o token.
- Exibir no máximo 8 resultados e informar quando não houver correspondência.

## Fora de escopo

- Respostas pessoais por usuário, pastas e atalhos com parâmetros.
- Envio automático ao pressionar Enter no seletor.

## Testes e aceite

- Normalização e unicidade do atalho.
- Permissões e isolamento do workspace.
- Testes do parser do composer e navegação por teclado.
- Aceite: cadastrar `/pix`, digitar o atalho no chat e inserir o conteúdo e sua mídia sem enviá-los automaticamente.
