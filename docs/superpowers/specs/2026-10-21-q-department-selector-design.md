# Q — Departamento por lista

Data: 21/10/2026  
Roadmap: item 2.6.

## Objetivo

Trocar fila e responsável digitados livremente por referências válidas aos departamentos e membros do workspace.

## Dados

- Adicionar `Conversation.departmentId?` com relação `Department` e índice.
- Manter `queue` temporariamente como snapshot de compatibilidade e para dados antigos.
- Config do bloco Departamento: `{departmentId?, assigneeId?}`; pelo menos um obrigatório.
- Config do Controlador de Chat usa os mesmos identificadores.

## Migração

- Para cada `Conversation.queue`, associar departamento ativo com nome igual sem diferenciar caixa, apenas quando houver uma correspondência única.
- Definições antigas com `config.queue` são normalizadas no editor quando encontrarem departamento único.
- Sem correspondência, manter o texto legado e exibir pendência; nunca escolher silenciosamente.

## API e editor

- Reusar `GET /v1/workspace/departments`, incluindo membros ativos.
- Select de departamento mostra cor, nome e estado.
- Select de responsável é filtrado pelos membros do departamento; “qualquer atendente” é permitido.
- Departamento inativo continua visível numa configuração antiga, desabilitado e com aviso.

## Runtime

- Resolver departamento e membership no momento da execução, sempre pelo workspace.
- Atualizar `departmentId`, `queue` com o nome atual, `assigneeId` e status coerente.
- Departamento/responsável inválido usa saída de erro quando o bloco a possuir; caso contrário falha claramente.

## Testes e aceite

- Migração por nome único, ambiguidade e departamento inexistente.
- Isolamento de workspace e responsável fora do departamento.
- Aceite: renomear um departamento não quebra o fluxo, e o bloco sempre encaminha usando o ID cadastrado.
