# U — Comprovante estruturado e contrato Kovil

Data: 21/10/2026  
Roadmap: item 3.3 · Bloqueador dos FUNIL-03, 04 e 05.

## Objetivo

Fazer o Bloco de IA produzir dados de comprovante reutilizáveis entre fluxos e permitir que a Integração envie esses dados à Kovil. Não presumir um endpoint que a Kovil ainda não confirmou.

## Saída estruturada da IA

Quando `identifyReceipt=true`, exigir JSON:

```json
{
  "response": "texto ao cliente",
  "receiptValid": true,
  "receipt": {
    "valor": "150.00",
    "moeda": "BRL",
    "nome_pagador": "Nome",
    "data": "2026-10-21",
    "referencia": "identificador"
  },
  "conditionId": null
}
```

- `valor` decimal canônico, positivo; converter para `valueCents` internamente.
- `data` ISO quando legível; campos não encontrados são `null`.
- `receiptValid=true` exige valor e ao menos pagador ou referência.
- Texto livre ou JSON fora do schema segue a saída de erro, nunca marca comprovante válido.

## Persistência

`ReceiptAnalysis`:

- `id`, `workspaceId`, `contactId`, `conversationId`, `messageId`, `executionId`, `valueCents?`, `currency?`, `payerName?`, `paidAt?`, `reference?`, `valid`, `rawEncrypted`, `expiresAt`, timestamps;
- único por `(messageId, executionId)`;
- retenção de 30 dias, alinhada à mídia recebida; job apaga análise e mídia expirada.

O runtime injeta a análise atual como:

- `comprovante.valor`, `comprovante.valor_centavos`, `comprovante.moeda`;
- `comprovante.nome_pagador`, `comprovante.data`, `comprovante.referencia`.

Flow jump e retomadas recarregam a última análise válida da conversa/contato; não dependem do contexto do fluxo anterior.

## Privacidade

- Raw JSON cifrado e nunca retornado em listagens.
- Acesso restrito a quem pode ler a conversa.
- Não enviar imagem/PDF à Kovil automaticamente; somente o objeto configurado na Integração.

## Contrato Kovil

Body proposto para homologação:

```json
{
  "phone": "{{contact.phone}}",
  "channel": "{{channel.phone}}",
  "flow_id": "{{trigger.flowId}}",
  "receipt": {
    "value_cents": "{{comprovante.valor_centavos}}",
    "currency": "{{comprovante.moeda}}",
    "payer_name": "{{comprovante.nome_pagador}}",
    "paid_at": "{{comprovante.data}}",
    "reference": "{{comprovante.referencia}}"
  }
}
```

O URL e a autenticação permanecem configuráveis no bloco Integração. Produção só é liberada após a Kovil confirmar endpoint, campos, respostas, idempotency key e ambiente de homologação.

## Testes e aceite

- Parser de payload completo, parcial, inválido e recusa da IA.
- Persistência idempotente, retenção e isolamento.
- Flow jump conserva variáveis via `ReceiptAnalysis`.
- Integração testada contra servidor mock com contrato acordado.
- Aceite: enviar imagem de comprovante, obter campos estruturados no FUNIL-03 e usá-los no FUNIL-04/05 e no body da integração.
