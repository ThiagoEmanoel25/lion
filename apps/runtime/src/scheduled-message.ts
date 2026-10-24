import type {PrismaClient} from '@prisma/client';

export async function dispatchScheduledMessage(prisma:PrismaClient,id:string){
  await prisma.$transaction(async tx=>{
    const scheduled=await tx.scheduledMessage.findUnique({where:{id},include:{conversation:true}});
    if(!scheduled||scheduled.status!=='PENDING'||scheduled.sentMessageId)return;
    const claim=await tx.scheduledMessage.updateMany({where:{id,status:'PENDING',sentMessageId:null},data:{status:'PROCESSING',error:null}});
    if(!claim.count)return;
    if(scheduled.conversation.status==='RESOLVED'||scheduled.conversation.mode!=='HUMAN'){
      await tx.scheduledMessage.update({where:{id},data:{status:'FAILED',error:'A conversa não está disponível para envio humano.'}});return;
    }
    const message=await tx.message.create({data:{workspaceId:scheduled.workspaceId,conversationId:scheduled.conversationId,direction:'OUTBOUND',type:'TEXT',status:'QUEUED',body:scheduled.body,authorType:'user',authorId:scheduled.authorId,clientRequestId:`scheduled:${scheduled.id}`}});
    await tx.scheduledMessage.update({where:{id},data:{sentMessageId:message.id}});
    await tx.outboxEvent.create({data:{workspaceId:scheduled.workspaceId,aggregate:'Message',aggregateId:message.id,type:'message.send.requested',payload:{messageId:message.id}}});
  });
}
