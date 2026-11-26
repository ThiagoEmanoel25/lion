/** Mapas de rótulos pt-BR. Sempre com fallback ao valor original: um código novo da API nunca some da tela. */
export const label=(map:Record<string,string>,value:string|null|undefined)=>value?(map[value]??map[value.toUpperCase()]??map[value.toLowerCase()]??value):'';

export const ROLE_LABELS:Record<string,string>={OWNER:'Proprietário',ADMIN:'Administrador',SUPERVISOR:'Supervisor',AGENT:'Agente',VIEWER:'Leitor'};
export const INVITE_STATUS_LABELS:Record<string,string>={PENDING:'Pendente',ACCEPTED:'Aceito',REVOKED:'Revogado',EXPIRED:'Expirado'};
export const PLAN_LABELS:Record<string,string>={free:'Gratuito',starter:'Starter',growth:'Growth',scale:'Scale',enterprise:'Enterprise',unlimited:'Ilimitado'};
export const SUBSCRIPTION_STATUS_LABELS:Record<string,string>={active:'Ativa',trialing:'Em teste',past_due:'Pagamento em atraso',canceled:'Cancelada',cancelled:'Cancelada',incomplete:'Incompleta',paused:'Pausada'};
export const PROVIDER_LABELS:Record<string,string>={local:'Gerenciado localmente',stripe:'Stripe',asaas:'Asaas'};

export const AUDIT_ACTIONS:Record<string,string>={
  'auth.refresh_reuse_detected':'Reuso de sessão detectado',
  'broadcast.create':'Disparo criado','broadcast.start':'Disparo iniciado','broadcast.pause':'Disparo pausado','broadcast.cancel':'Disparo cancelado',
  'business_hours.updated':'Horários de atendimento atualizados',
  'channel.automation_changed':'Fluxo de boas-vindas do canal alterado','channel.created':'Canal criado',
  'channel.flow_settings_bulk_changed':'Configurações de fluxo alteradas em vários canais','channel.flow_settings_changed':'Configurações de fluxo do canal alteradas',
  'contact.consent_blocked_opted_out':'Consentimento bloqueado: contato pediu para sair','contact.consent_reconsented':'Contato deu consentimento novamente',
  'contact.consent_granted':'Consentimento registrado','contact.consent_revoked':'Consentimento revogado','contact.consent_given':'Consentimento registrado',
  'contact.created':'Contato criado','contact.updated':'Contato atualizado','contact_tag.created':'Etiqueta criada','contacts.imported':'Contatos importados',
  'conversation.assigned':'Conversa atribuída','conversation.mode_changed':'Modo da conversa alterado','conversation.status_changed':'Status da conversa alterado','conversation.transitioned':'Conversa movida de etapa',
  'department.created':'Fila criada','department.updated':'Fila atualizada',
  'global_variable.created':'Variável global criada','global_variable.deleted':'Variável global excluída','global_variable.updated':'Variável global atualizada',
  'inbound_webhook.created':'Webhook de entrada criado','inbound_webhook.disabled':'Webhook de entrada desativado','inbound_webhook.event_replayed':'Entrega de webhook reprocessada','inbound_webhook.secret_rotated':'Segredo do webhook renovado','inbound_webhook.updated':'Webhook de entrada atualizado',
  'kanban.board_created':'Quadro do Kanban criado','kanban.board_deleted':'Quadro do Kanban excluído','kanban.board_updated':'Quadro do Kanban atualizado',
  'kanban.card_created':'Cartão adicionado ao Kanban','kanban.card_deleted':'Cartão removido do Kanban','kanban.card_moved':'Cartão movido no Kanban',
  'kanban.column_created':'Coluna do Kanban criada','kanban.column_deleted':'Coluna do Kanban excluída','kanban.column_updated':'Coluna do Kanban atualizada',
  'member.invite_accepted':'Convite aceito','member.invite_revoked':'Convite revogado','member.invited':'Convite enviado','member.updated':'Membro atualizado',
  'pixel.created':'Pixel criado','pixel.deleted':'Pixel excluído','pixel.updated':'Pixel atualizado',
  'playbook.archived':'Fluxo arquivado','playbook.execution_cancelled':'Execução de fluxo cancelada','playbook.execution_requested':'Execução de fluxo solicitada','playbook.folder_changed':'Fluxo movido de pasta',
  'playbook.imported_from_leona':'Fluxo importado','playbook.imported_from_nexo':'Fluxo importado','playbook.paused':'Fluxo pausado','playbook.published':'Fluxo publicado','playbook.resumed':'Fluxo retomado',
  'playbook.share_code_created':'Código de compartilhamento do fluxo criado','playbook.simulation.live_call':'Simulação de fluxo com chamada real','playbook.unarchived':'Fluxo desarquivado','playbook.version_created':'Nova versão de fluxo criada',
  'playbook_folder.created':'Pasta de fluxos criada','playbook_folder.deleted':'Pasta de fluxos excluída','playbook_folder.renamed':'Pasta de fluxos renomeada',
  'quick_reply.created':'Resposta rápida criada','quick_reply.deleted':'Resposta rápida excluída','quick_reply.updated':'Resposta rápida atualizada',
  'scheduled_message.cancelled':'Mensagem agendada cancelada','scheduled_message.created':'Mensagem agendada criada',
  'whatsapp.session_created':'Sessão de WhatsApp criada','whatsapp.session_disconnect_requested':'Desconexão do WhatsApp solicitada',
  'workspace.ai_key.removed':'Chave de IA removida','workspace.ai_key.updated':'Chave de IA atualizada','workspace.updated':'Dados do workspace atualizados'
};
export const auditActionLabel=(action:string)=>AUDIT_ACTIONS[action]??action;

/** "1 cartão", "0 cartões", "2 cartões". */
export const plural=(count:number,one:string,many:string)=>`${count} ${count===1?one:many}`;

export const LOCALES:Array<[string,string]>=[['pt-BR','Português (Brasil)'],['en-US','English (United States)'],['es-ES','Español (España)']];
const FALLBACK_ZONES=['America/Sao_Paulo','America/Bahia','America/Manaus','America/Fortaleza','America/Recife','America/Belem','America/Cuiaba','America/Rio_Branco','America/Noronha','America/Argentina/Buenos_Aires','America/Santiago','America/Bogota','America/Mexico_City','America/New_York','America/Chicago','America/Los_Angeles','Europe/Lisbon','Europe/Madrid','Europe/London','UTC'];
/** Todos os fusos do navegador; lista curta quando o navegador não expõe `Intl.supportedValuesOf`. */
export function timeZoneList(current?:string):string[]{
  let zones:string[]=FALLBACK_ZONES;
  try{const all=(Intl as unknown as {supportedValuesOf?:(key:string)=>string[]}).supportedValuesOf?.('timeZone');if(all?.length)zones=all.includes('UTC')?all:[...all,'UTC']}catch{/* navegador antigo */}
  return current&&!zones.includes(current)?[current,...zones]:zones;
}
