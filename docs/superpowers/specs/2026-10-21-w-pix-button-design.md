# W — Botão PIX no Baileys

Data: 21/10/2026  
Roadmap: item 3.5.

## Objetivo

Adicionar o bloco PIX útil no canal não oficial: enviar uma mensagem clara com chave e valor para copiar, sem prometer o card oficial da Cloud API.

## Contrato

Novo kind `pix`, com uma saída padrão.

Config:

- `keyType`: `CPF`, `CNPJ`, `PHONE`, `EMAIL`, `RANDOM`;
- `key`: template obrigatório;
- `recipient`: template obrigatório;
- `value?`: template monetário;
- `currency`: `BRL` no primeiro escopo;
- `message?`: texto de introdução;
- `imageUrl?`: somente como mídia comum, sem card PIX oficial.

## Validação

- CPF/CNPJ removem máscara e validam dígitos verificadores.
- Telefone em E.164, e-mail básico válido e chave aleatória UUID quando literal.
- Valores dinâmicos são validados novamente após interpolação.
- Chave inválida usa erro de execução; não enviar dado parcialmente renderizado.

## Envio

Mensagem padrão:

```text
Pagamento via PIX
Destinatário: Nome
Valor: R$ 150,00
Chave (E-mail): pagamento@empresa.com
Copie a chave acima no aplicativo do seu banco.
```

- Enviar pelo fluxo normal de mensagens/outbox e guardar `externalId`.
- Se houver imagem, enviar primeiro e depois o texto/chave, respeitando sequência.
- Não usar botão nativo “copiar”, deep link bancário ou cobrança dinâmica no Baileys.

## Editor e canvas

- Campos com seletor `<>`, máscara apenas visual e pré-visualização da mensagem.
- Aviso: “No Baileys será enviada uma chave copiável; o card PIX oficial exige Cloud API.”
- Canvas mostra tipo, destinatário e valor sem expor chave sensível completa.

## Importador

- `pix` e o alias “Pagamento” mapeiam para este bloco.
- Campos exclusivos do card oficial entram como ajustados/ignorados no relatório.

## Testes e aceite

- Validadores de todos os tipos, interpolação e valor BRL.
- Ordem imagem/texto e falha antes de enviar em chave inválida.
- Aceite: contato recebe destinatário, valor e chave legível e copiável em uma mensagem Baileys.
