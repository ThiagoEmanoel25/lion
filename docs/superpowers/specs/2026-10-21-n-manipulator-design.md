# N — Bloco Manipulador

Data: 21/10/2026  
Roadmap: item 2.3.

## Objetivo

Adicionar o bloco do Leona que define ou calcula campos persistentes do contato e variáveis da execução.

## Contrato

Novo kind `manipulator`, com portas `success` obrigatória e `failure` opcional.

Config:

- `target`: `contact.customFields.<nome>` ou `flow.<caminho>`;
- `operation`: `set`, `add`, `subtract`, `multiply`, `divide`;
- `value`: literal ou template com `{{variavel}}`;
- `failureVariable`: padrão `manipulator.error`.

O nome de campo personalizado segue 1–60 caracteres e `[A-Za-z0-9_.-]`. Caminhos reservados `_runtime`, `contact.id`, `workspace` e credenciais são recusados.

## Semântica

- `set` aceita texto, número, booleano ou JSON válido.
- Operações matemáticas convertem valor atual e operando para número finito.
- Campo inexistente começa em zero para `add`/`subtract`; `multiply` e `divide` exigem valor existente.
- Divisão por zero e valor não numérico seguem `failure`; sem saída de erro, falham a execução.
- `flow.*` altera somente o contexto atual.
- `contact.customFields.*` persiste no contato e atualiza também o contexto da execução.

## Consistência

- Atualização do contato ocorre em transação serializável com retry para conflito.
- Usar operação atômica no JSONB ou bloqueio da linha; nunca ler e gravar fora da mesma transação.
- O step registra alvo, operação, valor anterior e novo valor, sem registrar segredo global resolvido.

## Editor e canvas

- Seletor de destino com grupos Campos do contato e Variáveis do fluxo.
- Select da operação e campo de valor com seletor `<>`.
- Preview: “Definir campo = valor”, “Somar 1 a tentativas”.
- Saídas visuais sucesso/erro no padrão Integração.

## Importador

- `manipulator`/`save_user_data` isolado vira o novo bloco.
- Operações desconhecidas geram pendência e preservam configuração original em `importSource`.

## Testes e aceite

- Todas as operações, campo ausente, divisão por zero e concorrência.
- Compiler exige alvo, operação e saída de sucesso.
- Aceite: executar “Somar 1 a tentativas” duas vezes resulta em `tentativas = 2` no contato e nas condições seguintes.
