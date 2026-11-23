const scheduled:Record<string,string>={PENDING:'Pendente',PROCESSING:'Enviando',SENT:'Enviada',CANCELLED:'Cancelada',FAILED:'Falhou'};
export const scheduledStatusLabel=(value:string)=>scheduled[value]??value;
/** Valida a data/hora do agendamento (datetime-local). Retorna a mensagem de erro ou null. */
export function scheduleError(value:string,now=new Date()){if(!value)return 'Escolha a data e a hora do envio.';const date=new Date(value);if(Number.isNaN(date.getTime()))return 'Data e hora inválidas.';if(date.getTime()<=now.getTime()+30_000)return 'Escolha um horário no futuro.';return null}
