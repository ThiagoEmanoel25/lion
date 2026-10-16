import {kanbanAction,type KanbanMode,DomainError} from '@nexo/domain';

export type KanbanActor={type:'user'|'execution';id:string};

export async function applyKanbanCardAction(prisma:any,input:{workspaceId:string;boardId:string;columnId:string;contactId:string;conversationId?:string|null;mode:KanbanMode;actor:KanbanActor}){
  return prisma.$transaction(async(tx:any)=>{
    const column=await tx.kanbanColumn.findFirst({where:{id:input.columnId,boardId:input.boardId,board:{workspaceId:input.workspaceId}},select:{id:true}});
    if(!column)throw new DomainError('KANBAN_TARGET_NOT_FOUND','O quadro ou a coluna do Kanban não existe.',422);
    const contact=await tx.contact.findFirst({where:{id:input.contactId,workspaceId:input.workspaceId},select:{id:true}});
    if(!contact)throw new DomainError('CONTACT_NOT_FOUND','O contato do card não existe.',404);
    if(input.conversationId){const conversation=await tx.conversation.findFirst({where:{id:input.conversationId,workspaceId:input.workspaceId,contactId:input.contactId},select:{id:true}});if(!conversation)throw new DomainError('CONVERSATION_NOT_FOUND','A conversa do card não existe.',404)}
    const existing=await tx.kanbanCard.findUnique({where:{boardId_contactId:{boardId:input.boardId,contactId:input.contactId}}});
    const action=kanbanAction(input.mode,existing?.columnId??null,input.columnId);
    if(action==='noop')return {action,card:existing};
    const position=await tx.kanbanCard.count({where:{columnId:input.columnId}});
    if(action==='create'){
      const card=await tx.kanbanCard.create({data:{boardId:input.boardId,columnId:input.columnId,contactId:input.contactId,conversationId:input.conversationId??null,position,movedByType:input.actor.type,movedById:input.actor.id}});
      await tx.kanbanCardEvent.create({data:{cardId:card.id,toColumnId:input.columnId,movedByType:input.actor.type,movedById:input.actor.id}});
      return {action,card};
    }
    const fromColumnId=existing!.columnId;
    const card=await tx.kanbanCard.update({where:{id:existing!.id},data:{columnId:input.columnId,position,conversationId:input.conversationId??existing!.conversationId,movedAt:new Date(),movedByType:input.actor.type,movedById:input.actor.id}});
    await tx.kanbanCardEvent.create({data:{cardId:card.id,fromColumnId,toColumnId:input.columnId,movedByType:input.actor.type,movedById:input.actor.id}});
    await tx.kanbanCard.updateMany({where:{columnId:fromColumnId,position:{gt:existing!.position}},data:{position:{decrement:1}}});
    return {action,card};
  });
}

export async function relocateAndDeleteColumn(prisma:any,input:{workspaceId:string;columnId:string;destinationColumnId?:string;actor:KanbanActor}){
  return prisma.$transaction(async(tx:any)=>{
    const column=await tx.kanbanColumn.findFirst({where:{id:input.columnId,board:{workspaceId:input.workspaceId}},include:{_count:{select:{cards:true}}}});
    if(!column)throw new DomainError('NOT_FOUND','Coluna não encontrada.',404);
    let destination:null|{id:string}=null;
    if(column._count.cards>0){
      if(!input.destinationColumnId)throw new DomainError('KANBAN_DESTINATION_REQUIRED','Escolha uma coluna de destino para os cards.',422);
      if(input.destinationColumnId===column.id)throw new DomainError('KANBAN_DESTINATION_INVALID','A coluna de destino precisa ser diferente.',422);
      destination=await tx.kanbanColumn.findFirst({where:{id:input.destinationColumnId,boardId:column.boardId},select:{id:true}});
      if(!destination)throw new DomainError('KANBAN_DESTINATION_INVALID','A coluna de destino não pertence a este quadro.',422);
      const offset=await tx.kanbanCard.count({where:{columnId:destination.id}});
      const cards=await tx.kanbanCard.findMany({where:{columnId:column.id},orderBy:[{position:'asc'},{createdAt:'asc'}],select:{id:true}});
      for(const [index,card] of cards.entries()){
        await tx.kanbanCard.update({where:{id:card.id},data:{columnId:destination.id,position:offset+index,movedAt:new Date(),movedByType:input.actor.type,movedById:input.actor.id}});
        await tx.kanbanCardEvent.create({data:{cardId:card.id,fromColumnId:column.id,toColumnId:destination.id,movedByType:input.actor.type,movedById:input.actor.id}});
      }
    }
    await tx.kanbanColumn.delete({where:{id:column.id}});
    return {deleted:true,relocated:column._count.cards,destinationColumnId:destination?.id??null};
  });
}
