# 15 Assets: allowlist de MIME e download seguro
Status: pendente
Origem: P1-2 em `docs/REVISAO.md`
Esforço estimado: P

## Arquivos
apps/api/src/modules/assets/routes.ts (e `contentTypeOf`), testes novos

## Escopo
Allowlist de tipos (imagem, áudio, vídeo, PDF, documentos de escritório comuns); recusar `text/html`, `image/svg+xml` e afins ou servi-los como `application/octet-stream` com `content-disposition: attachment`; sempre `X-Content-Type-Options: nosniff`; validar tamanho (`MAX_ASSET_BYTES`) e extensão coerente com o tipo; manter compatibilidade com o fluxo atual do editor de fluxos (`nexo-asset://`).

## Critérios de aceite
Testes: upload de HTML/SVG não é executável na origem da API; tipos permitidos continuam funcionando; E2E e testes do editor de fluxos verdes.

## Regras
Regras comuns: ler `docs/REVISAO.md` (item citado) antes de editar; mudança mínima e completa; rodar `npm run typecheck`, `npm test` e `npm run build`; se tocar o frontend, rodar `npm run test:e2e` e conferir os prints (desktop e mobile). Proibido: commit, push, deploy, credenciais reais; banco/Redis de teste só em containers temporários (portas 55432/56379), removidos no fim.
