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

export function listTransition(status:ConversationStatus,direction:'back'|'forward',userId:string,now=new Date()){
  if(direction==='forward'){
    if(status==='ASSIGNED')return {status:'RESOLVED' as const,mode:'HUMAN' as const,assigneeId:userId,resolvedAt:now,unreadCount:0};
    if(status==='RESOLVED')return null;
    return {status:'ASSIGNED' as const,mode:'HUMAN' as const,assigneeId:userId,resolvedAt:null};
  }
  if(status==='RESOLVED')return {status:'ASSIGNED' as const,mode:'HUMAN' as const,assigneeId:userId,resolvedAt:null};
  if(status==='ASSIGNED')return {status:'QUEUED' as const,mode:'HUMAN' as const,assigneeId:null,resolvedAt:null};
  return null;
}
