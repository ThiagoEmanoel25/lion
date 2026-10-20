# Paridade da plataforma com o Leona (fora do construtor de fluxos)

Auditoria de 20/10/2026, feita só com leitura das telas do Leona. Nenhuma conversa foi aberta (abrir marcaria como lida) e nada foi salvo; os painéis abertos foram fechados com Cancelar. Nomes de clientes, telefones e IDs não foram registrados.

Os blocos de fluxo estão em [leona-flow-parity.md](leona-flow-parity.md).

**Legenda:** ✅ Nexo tem · 🟡 parcial · ❌ falta · ➖ não se aplica ou não vale copiar.

## 1. Como os fluxos começam (o ponto mais importante)

No Leona, cada **conexão** (número de WhatsApp) tem **4 fluxos padrão** e **palavras-chave** (Configurações → Fluxos Padrões):

| Slot | Quando roda |
|---|---|
| Boas-vindas | Primeira mensagem do contato (no seu caso: GELATINA-FUNIL-01) |
| Conversa finalizada | Quando a conversa é finalizada |
| Resposta padrão | Quando o contato escreve e nenhum fluxo está rodando, com janela em horas (padrão 24 h) |
| Atendimento finalizado | Quando o atendente finaliza o atendimento |
| Palavras-chave | Uma palavra recebida dispara um fluxo |

Há também "Seleção em massa", que aplica a mesma configuração em várias conexões. O Início dentro do fluxo **não tem editor**: o gatilho é sempre definido aqui.

**Nexo:** 🟡 um "playbook ativo" por canal, e o gatilho é configurado dentro do fluxo (mensagem recebida, conversa criada, etiqueta adicionada, uma vez por contato). **Falta:** os 4 slots por conexão e as palavras-chave. Essa é a lacuna de função mais importante para migrar clientes do Leona sem mudar o hábito deles.

## 2. Telas principais

| Leona | O que tem | Nexo |
|---|---|---|
| **Dashboard** | Abas Vendas e Atendimento; filtros de período, conexão, produto e moeda; grupos de filtro salvos; cards de Leads novos, Faturamento, Vendas, ROAS, Taxa de conversão, Ticket médio, Lucro e Gasto Meta (Ads); gráficos por período, horário, instância e estado; histórico de vendas (instância, lead, produto, valor, moeda, Source ID, NF) com "Nova venda" e "Exportar CSV"; "Configurar taxas e despesas" | 🟡 O Dashboard e os Resultados do Nexo cobrem conversas, desfechos, custo por desfecho e desempenho dos playbooks. **Falta tudo de vendas:** produto, faturamento, ROAS, gasto em anúncio, lucro e vendas por instância |
| **Chats ao vivo** | Abas Aguardando, Atendendo e Resolvidos; filtros Tudo, Não lidas e Não respondidas; setas para mover o chat entre estados; "Criar novo chat"; **Mensagens agendadas**; etiqueta da conexão em cada chat | 🟡 O Nexo tem inbox com status, IA ou humano, responsável, fila, etiquetas e a execução do fluxo ao lado. **Falta:** Não lidas/Não respondidas, criar chat novo, mensagens agendadas e as setas de estado |
| **Kanban** | Lista de quadros, "Novo Kanban" | ✅ |
| **Contatos** | Busca, filtros por status e origem, Importar CSV, **Importar do WhatsApp**, Exportar CSV, Novo contato, abrir chat a partir do contato | 🟡 O Nexo tem busca, filtros, etapas, importação e exportação CSV. **Falta:** importar contatos do WhatsApp |
| **Agentes de IA** | Abas Agentes e **Vozes**; Modelos; **Criar com IA** | 🟡 O Nexo tem agentes e base de conhecimento (o Leona não mostra base de conhecimento). **Falta:** vozes, modelos prontos e criar agente com IA |
| **Conexões** | Tabela com Conexão, Tipo, Status, Criada em e Desconectada em; filtros Conectadas e Desconectadas; busca por nome ou número | ✅ (Configurações → Canais) |
| **Webhooks de entrada** | Lista com busca, "Novo webhook" | ✅ |
| **Disparos em massa** | Disparos com cota ("Como funciona a cota de disparos") | ❌ Tem risco de bloqueio no WhatsApp não oficial; precisa de limite e de opt-in |
| **Facebook** | Campanhas, ligado ao ROAS e ao gasto em anúncios do Dashboard | ❌ (o Nexo tem só o Pixel) |
| **Cobranças e assinaturas** | Plano, **instâncias compradas**, **tokens Leona**, faturas, reembolsos, trocar cartão, cancelar | 🟡 O Nexo tem billing com plano e cota de execuções |

## 3. Configurações

| Leona | Nexo |
|---|---|
| Empresa, Equipe, Convites, Acesso de suporte | ✅ Workspace e Equipe/acessos. ❌ Acesso de suporte |
| Departamentos | ✅ Filas e departamentos (falta usar no bloco Departamento) |
| Horários de Trabalho | ✅ Horários. Dá para reaproveitar no modo "Horários" do Intervalo Inteligente |
| Traduções de fluxo, Uso da Leona AI | ❌ |
| **Fluxos Padrões** | ❌ (ver seção 1) |
| **Respostas Rápidas** | ❌ |
| Templates WhatsApp | ❌ (exige a API oficial) |
| **Variáveis Globais** | ❌ Variáveis usadas em todos os fluxos, por exemplo link do grupo ou chave PIX |
| Campos Personalizados, Etiquetas | ✅ |
| **Integrações** (catálogo) | 🟡 O Nexo tem OpenAI e Pixel. O Leona oferece Notas fiscais (Notasy), Trackeamento (UTMify), IA (OpenAI, Gemini, OpenRouter, ElevenLabs, BIZIVA) e Pagamentos (Leona Pay, XPag, Zenith) |
| Trackeamento | ❌ |
| **Produtos** | ❌ Nome, moeda, **preço mínimo, preço máximo e valor padrão**. A Venda aprovada usa essa faixa para aceitar o valor lido do comprovante |
| Ferramentas MCP | ❌ Credenciais para agentes externos operarem a conta |
| — | O Nexo tem **Auditoria**, que o Leona não mostra |

## 4. O que fazer primeiro

1. **Fluxos padrão por conexão** (Boas-vindas, Resposta padrão, Conversa finalizada, Atendimento finalizado) e **palavras-chave**. Sem isso, um cliente do Leona não consegue reproduzir a operação dele no Nexo.
2. **Chats:** Não lidas/Não respondidas, mensagens agendadas e "criar chat". É o uso diário do atendente.
3. **Respostas rápidas** e **Variáveis globais**. São pequenos e muito usados.
4. **Produtos + Venda aprovada + dashboard de vendas**, junto com o fluxo de comprovante. Isso também resolve a dependência da Kovil.
5. Depois: importar contatos do WhatsApp, disparos em massa com cota, campanhas do Facebook/ROAS e catálogo de integrações.

## O que não foi verificado

O conteúdo interno de Disparos em massa (sem disparos na conta), Facebook (a tela estava vazia), Variáveis globais (nenhuma criada), o formulário de "Criar nova conexão" e as telas de detalhe de chat e de contato. Também não foi visto o que o Dashboard do Leona mostra na aba Atendimento.
