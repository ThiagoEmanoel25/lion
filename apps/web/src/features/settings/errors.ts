import {ApiError} from '../../shared/api/client';

/** Mensagens em pt-BR por código de erro da API. Só os códigos que a interface precisa explicar melhor que o servidor. */
const CODE_MESSAGES:Record<string,string>={
  INVALID_TIMEZONE:'Fuso horário inválido. Escolha um fuso da lista.',
  USER_EXISTS:'Este e-mail já tem uma conta no Zuno Flow. Um e-mail pertence a uma única conta, por isso ele não pode ser convidado para este workspace. Convide outro e-mail.',
  KANBAN_CARD_EXISTS:'Este contato já está neste quadro.',
  KANBAN_COLUMN_INVALID:'A coluna escolhida não pertence a este quadro.',
  KANBAN_BOARD_EXISTS:'Já existe um quadro com este nome.',
  KANBAN_COLUMN_EXISTS:'Já existe uma coluna com este nome.',
  AUDIENCE_FILTER_REQUIRED:'Escolha ao menos uma etiqueta, etapa ou contato. Para enviar a toda a base, marque “Enviar para toda a base com consentimento” e confirme.',
  EMPTY_AUDIENCE:'Nenhum contato com consentimento registrado corresponde a esse público.',
  CHANNEL_IN_USE:'Este número tem disparos em andamento ou agendados. Cancele ou conclua os disparos antes de remover o número.',
  CHANNEL_PHONE_EXISTS:'Este número já está cadastrado em outro canal deste workspace.',
  CHANNEL_UNAVAILABLE:'A conexão precisa estar conectada para criar o disparo.',
  INVALID_SCHEDULE:'O início do disparo não pode estar no passado.',
  INVALID_PACING:'Os intervalos do disparo estão fora do permitido. Revise intervalo mínimo, máximo e cota diária.'
};

export const FIELD_LABELS:Record<string,string>={
  name:'Nome',email:'E-mail',role:'Perfil',timezone:'Fuso horário',locale:'Idioma',days:'Horários',outsideMessage:'Mensagem fora do horário',
  description:'Descrição',color:'Cor',shortcut:'Atalho',body:'Mensagem',value:'Valor',pixelId:'ID do pixel',accessToken:'Token de acesso',
  apiKey:'Chave',model:'Modelo',objective:'Objetivo',systemPrompt:'Prompt de sistema',handoffMessage:'Mensagem de handoff',
  channelId:'Conexão',playbookId:'Fluxo',startAt:'Início',dailyQuota:'Cota por dia',minIntervalSeconds:'Intervalo mínimo',maxIntervalSeconds:'Intervalo máximo',audience:'Público',contactId:'Contato',columnId:'Coluna',title:'Título',note:'Observação'
};

/** Traduz as mensagens padrão do zod; mensagens que já vêm em português passam intactas. */
export function translateIssue(message:string):string{
  const text=message.trim();
  if(/Invalid email/i.test(text))return 'e-mail inválido';
  let match=text.match(/expected string to have >=(\d+) characters?/i);if(match)return `use ao menos ${match[1]} caractere${match[1]==='1'?'':'s'}`;
  match=text.match(/expected string to have <=(\d+) characters?/i);if(match)return `use no máximo ${match[1]} caracteres`;
  if(/expected string, received undefined|Required|expected .* received undefined/i.test(text))return 'campo obrigatório';
  if(/Invalid (string|input|enum|option)|Invalid /i.test(text)&&/^[\x00-\x7F]*$/.test(text))return 'valor inválido';
  return text;
}

export function describeFieldErrors(details:unknown):string{
  const fields=(details as {fieldErrors?:Record<string,string[]|undefined>}|null|undefined)?.fieldErrors;
  if(!fields)return '';
  return Object.entries(fields).filter(([,issues])=>issues?.length).map(([field,issues])=>`${FIELD_LABELS[field]??field}: ${[...new Set(issues!.map(translateIssue))].join(', ')}`).join(' · ');
}

/** Mensagem legível em pt-BR para qualquer erro de mutação; nunca devolve texto técnico em inglês. */
export function describeApiError(error:unknown,fallback:string):string{
  if(error instanceof ApiError){
    if(CODE_MESSAGES[error.code])return CODE_MESSAGES[error.code]!;
    if(error.code==='VALIDATION_ERROR'){const fields=describeFieldErrors(error.details);return fields?`Revise os dados enviados. ${fields}.`:'Revise os dados enviados: há campos inválidos.'}
    if(error.status===403)return 'Você não tem permissão para fazer isso. Peça a um administrador.';
    if(error.status>=500)return 'Algo deu errado do nosso lado. Tente novamente em instantes.';
    return error.message||fallback;
  }
  if(error instanceof Error&&/failed to fetch|networkerror|load failed/i.test(error.message))return 'Parece que a conexão caiu. Verifique sua internet e tente novamente.';
  return fallback;
}
