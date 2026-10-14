# Módulos do MVP

## Entregáveis funcionais

- **Auth e workspaces:** login, refresh token, convites e RBAC server-side.
- **Channels:** conexão Baileys por QR/pairing code, estado da sessão, reconexão, envio e recebimento idempotentes.
- **Contacts:** cadastro, busca, tags, campos e etapa comercial.
- **Inbox:** fila, atribuição, notas internas, mensagens e handoff IA/humano.
- **Playbooks:** editor visual, propriedades por nó, validação estrutural e semântica, simulação, versões imutáveis, publicação e logs de execução.
- **AI runtime:** conhecimento, ferramentas permitidas, políticas, fallback e custo.
- **Knowledge:** documentos, URLs, indexação e recuperação isolada por tenant.
- **Analytics:** desfechos, tempo de resposta, handoff, falhas e custo.
- **Billing:** plano, cotas, usage records e alertas de limite.
- **Admin/health:** saúde sem exposição pública de topologia ou custos.

## Regra de conclusão do MVP

Um workspace deve conseguir conectar um canal, importar conhecimento, publicar um playbook, receber uma mensagem, responder por IA, transferir com contexto para um humano, registrar um desfecho e visualizar custo e execução.
