export type ConversationMode='AI'|'HUMAN'|'PAUSED';
export type ConversationStatus='NEW'|'AUTOMATED'|'WAITING_CUSTOMER'|'QUEUED'|'ASSIGNED'|'RESOLVED';

export function modeTransition(mode:ConversationMode,userId:string){
  if(mode==='HUMAN')return {mode,assigneeId:userId,status:'ASSIGNED' as const};
  if(mode==='AI')return {mode,assigneeId:null,status:'AUTOMATED' as const};
  return {mode,assigneeId:null,status:'QUEUED' as const};
}

export function statusTransition(status:ConversationStatus,now=new Date()){
  return {status,resolvedAt:status==='RESOLVED'?now:null,unreadCount:status==='RESOLVED'?0:undefined};
}
