# 11 Webhook Meta: falhar fechado e validar sobre o corpo bruto
Status: pendente
Origem: P0-2 em `docs/REVISAO.md`
Esforço estimado: P

## Arquivos
apps/api/src/modules/webhooks/routes.ts (linha ~46), possível reaproveitamento do `captureRawBody` de `/v1/hooks/:publicId`, testes novos

## Escopo
Em produção (`NODE_ENV=production`) sem `META_APP_SECRET` o endpoint deve recusar (503/401) em vez de aceitar sem assinatura; calcular o HMAC SHA-256 sobre o corpo bruto (não `JSON.stringify(request.body)`) com comparação em tempo constante; manter a verificação GET de `META_VERIFY_TOKEN`; idempotência existente preservada; falha de assinatura logada em `warn` (sem payload).

## Critérios de aceite
Testes: assinatura válida passa; inválida 401; ausente em produção recusa; corpo com espaçamento/ordem de chaves diferente do `JSON.stringify` valida corretamente; nada é gravado em `rawWebhookEvent` quando recusado.

## Regras
Regras comuns: ler `docs/REVISAO.md` (item citado) antes de editar; mudança mínima e completa; rodar `npm run typecheck`, `npm test` e `npm run build`; se tocar o frontend, rodar `npm run test:e2e` e conferir os prints (desktop e mobile). Proibido: commit, push, deploy, credenciais reais; banco/Redis de teste só em containers temporários (portas 55432/56379), removidos no fim.
