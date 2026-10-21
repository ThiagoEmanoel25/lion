# S — Produtos

Data: 21/10/2026  
Roadmap: item 3.1.

## Objetivo

Cadastrar produtos e suas faixas de preço para que vendas manuais, comprovantes e o bloco Venda aprovada usem a mesma regra.

## Dados

`Product`:

- `id`, `workspaceId`, `name`, `normalizedName`, `currency`, `minPriceCents`, `maxPriceCents`, `defaultPriceCents`, `isActive`, timestamps;
- nome único por workspace entre produtos ativos;
- moeda ISO 4217 em maiúsculas, inicialmente BRL por padrão;
- valores inteiros em centavos, sem ponto flutuante;
- `0 <= min <= default <= max`; máximo técnico de 999.999.999 centavos.

Produto usado por venda não é excluído: fica inativo.

## API

- `GET /v1/products?status=&search=`: `contact.read`.
- `POST /v1/products`, `PATCH /v1/products/:id`: `workspace.manage`.
- `DELETE /v1/products/:id` desativa e registra auditoria.
- Respostas incluem contagem de vendas, mas não agregados caros na listagem principal.

## Frontend

- Configurações → **Produtos**.
- Lista com nome, moeda, faixa, valor padrão e estado.
- Modal criar/editar com inputs monetários localizados; converter para centavos antes da API.
- Estado vazio com ação **Criar primeiro produto**.
- Produto inativo continua acessível no histórico, mas não em seletores novos.

## Regra de preço

Função compartilhada `resolveProductPrice(product, candidate)`:

- valor válido dentro da faixa → candidato;
- ausente, inválido ou fora da faixa → valor padrão e motivo;
- moeda divergente é erro, não conversão automática.

## Testes e aceite

- Conversão monetária sem arredondamento indevido e invariantes da faixa.
- Unicidade, isolamento e desativação com histórico.
- Aceite: cadastrar produto BRL com mínimo, máximo e padrão e selecioná-lo em uma venda sem digitar seu ID.
