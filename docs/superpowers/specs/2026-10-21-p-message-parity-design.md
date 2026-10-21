# P — Mensagem: contato, sticker e exclusão por etiqueta

Data: 21/10/2026  
Roadmap: item 2.5 · Extensão da spec C.

## Objetivo

Completar os conteúdos e controles do bloco Mensagem sem remover os blocos separados Imagem, Áudio e Figurinha.

## Novos itens da sequência

- `contact`: `{type:'contact', name, phone}`; ambos aceitam variáveis e geram vCard 3.0.
- `sticker`: `{type:'sticker', url}`; aceita asset privado ou HTTPS e exige WebP de até 10 MB.
- Item texto ganha `deleteOnTagId?`.
- `typingSeconds`: `0` desliga; quando ligado, valores de 3 a 60 segundos.

O limite permanece em 30 itens e a ordem garantida continua usando o cursor da spec C.

## Envio no Baileys

- Contato envia `{contacts:{displayName, contacts:[{displayName,vcard}]}}`.
- Telefone é normalizado para E.164; vCard escapa `;`, `,`, barras e quebras.
- Sticker usa bytes WebP e `{sticker: buffer}`.
- Toda mensagem de texto enviada já guarda `externalId`; a regra de exclusão é ativada somente após `SENT`.

## Exclusão ao aplicar etiqueta

`MessageDeletionRule`:

- `messageId`, `contactId`, `tagId`, `status`, `deletedAt?`, `error?`;
- único por `(messageId, tagId)`.

Ao adicionar etiqueta:

1. localizar regras pendentes do contato/tag;
2. enfileirar `message.delete.requested` com idempotência;
3. Baileys envia delete para todos usando `remoteJid`, `fromMe:true`, `externalId`;
4. falha por janela expirada marca `FAILED` e não falha o bloco Etiqueta.

Remover etiqueta não restaura mensagem. Aplicar novamente não repete exclusão.

## Editor

- Botões + Contato e + Sticker na sequência.
- Texto mostra toggle **Apagar ao aplicar etiqueta** e seletor de etiqueta.
- Slider de digitando com “Desligado” ou 3–60 s.
- Preview do canvas contabiliza todos os conteúdos.

## Importador

- `contact`, `sticker` e a regra de exclusão entram na ordem original.
- Sticker externo do CDN da Leona gera aviso para substituir por upload local.

## Fora de escopo

- Varinha de reescrita por IA e localização.
- Garantir exclusão depois do limite imposto pelo WhatsApp.

## Testes e aceite

- vCard/escaping, validação WebP, sequência e presença.
- Regra de exclusão idempotente, janela expirada e etiqueta de outro workspace.
- Aceite: enviar contato e sticker em ordem e apagar o texto quando a etiqueta escolhida for aplicada.
