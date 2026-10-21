# M — Intervalo inteligente: duração, data e horários

Data: 21/10/2026  
Roadmap: item 2.2.

## Objetivo

Completar o bloco Intervalo Inteligente com os três modos observados no Leona e cálculo consistente no fuso do workspace.

## Contrato

`delay.config` passa a ser uma união discriminada:

- `{mode:'duration', duration:number, unit:'seconds'|'minutes'|'hours'|'days'}`;
- `{mode:'date', runAt:string}` em ISO 8601 com offset;
- `{mode:'schedule', timezone?:string, days:[{day:0..6, enabled, start:'HH:mm', end:'HH:mm'}]}`.

Config antiga `{seconds}` ou `{duration,unit}` é normalizada para `duration` ao abrir/compilar.

## Cálculo

- Duração: de 1 segundo a 31 dias.
- Data: se `runAt <= now`, continuar imediatamente; limite futuro de 365 dias.
- Horários:
  - se agora estiver em uma faixa ativa, continuar;
  - caso contrário, agendar o próximo início ativo;
  - ao menos um dia ativo;
  - `start < end`; faixa atravessando meia-noite fica fora do primeiro escopo;
  - usar o fuso do config ou do workspace e tratar mudança de horário legal com uma utilidade central e relógio injetável.

## Runtime

- Função pura `nextDelayAt(config, now, workspaceTimezone)` devolve instante UTC.
- BullMQ usa delay calculado; contexto guarda instante e modo para diagnóstico.
- Retomada é idempotente pelo `stepId`; reinício do worker não duplica passo.
- Alterar horários do workspace não muda job já agendado.

## Editor e canvas

- Modal com abas **Intervalo / Data / Horários**.
- Data usa `datetime-local`, exibe o fuso e converte para ISO no save.
- Horários mostra os sete dias, liga/desliga e faixa.
- **Usar horários de funcionamento** copia a configuração atual do workspace; não cria referência viva.
- Canvas: “Espera de 5 minutos”, “Até 25/10 14:00” ou “Seg–Sex 09:00–18:00”.

## Importação

- Mapear `smart_interval` por subtipo.
- Datas sem fuso usam o timezone do workspace e geram aviso no relatório.
- Configuração inválida entra como pendência e não é silenciosamente convertida em duração.

## Testes e aceite

- Antes/dentro/depois da faixa, virada de semana, fuso e transição de horário legal.
- Data passada e limite de 365 dias.
- Compiler e normalização legada.
- Aceite: executado sábado, um horário Seg–Sex 09:00–18:00 retoma segunda às 09:00 no fuso configurado.
