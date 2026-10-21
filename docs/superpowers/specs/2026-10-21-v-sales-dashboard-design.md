# V — Dashboard e histórico de vendas

Data: 21/10/2026  
Roadmap: item 3.4 · Depende de S e T.

## Objetivo

Adicionar visão comercial baseada em `Sale`, separada dos resultados operacionais já existentes.

## Filtros

- Período com presets 7, 30 e 90 dias e intervalo personalizado.
- Canal, produto e moeda.
- Timezone do workspace define início/fim do dia e agrupamentos.
- Filtros ficam na URL para compartilhar/recarregar.

## Métricas

- Leads novos, faturamento, vendas, ticket médio e taxa de conversão.
- Séries por dia e por hora.
- Ranking por canal e produto.
- ROAS, gasto Meta e lucro ficam desabilitados/fora de escopo até a integração Ads.
- Cancelamentos/estornos futuros não são simulados; enquanto não existirem, faturamento é soma das vendas aprovadas.

## API

- `GET /v1/sales/overview?from=&to=&channelId=&productId=&currency=`.
- `GET /v1/sales` paginado, ordenação determinística e mesmos filtros.
- `GET /v1/sales/export.csv` com streaming e limite de período.
- `POST /v1/sales` para venda manual: produto, contato, valor opcional, moeda e data.
- Permissões: leitura `analytics.read`; criação manual `contact.update`; exportação auditada.

## Consultas

- Usar agregações SQL sobre índices `(workspaceId, occurredAt)`, `(productId, occurredAt)` e `(contactId, occurredAt)`.
- Taxa de conversão: contatos com venda / leads criados no período, documentada na UI.
- Valores retornam em centavos e são formatados no cliente.
- CSV protege contra formula injection prefixando células iniciadas por `=`, `+`, `-` ou `@`.

## Frontend

- Dashboard ganha abas **Vendas** e **Atendimento**.
- Cards, série temporal, distribuição por horário, canais/produtos e tabela.
- Tabela mostra data, lead, canal, produto, valor, moeda e origem.
- Botões **Nova venda** e **Exportar CSV**.
- Estados vazios explicam que Venda aprovada ou registro manual alimentam a tela.

## Testes e aceite

- Agregações, fuso, filtros combinados, moedas separadas e CSV seguro.
- Venda manual respeita faixa do produto e auditoria.
- Aceite: uma venda de fluxo e uma manual aparecem nos cards, gráfico, tabela e CSV sem misturar moedas.
