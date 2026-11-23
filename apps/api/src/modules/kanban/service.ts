import {kanbanAction,type KanbanMode,DomainError} from '@nexo/domain';
import {audit} from '../../core/audit.js';

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

// Excluir coluna/quadro referenciado por um fluxo publicado quebraria o nó Kanban em silêncio na próxima execução.
// Bloqueia com 409 listando os fluxos; o usuário ajusta ou despublica o fluxo antes de excluir.
export async function assertNotUsedByPublishedFlow(tx:any,workspaceId:string,target:{boardId?:string;columnId?:string}){
  const flows=await tx.playbook.findMany({where:{workspaceId,archivedAt:null,status:'PUBLISHED',activeVersionId:{not:null}},select:{id:true,name:true,activeVersion:{select:{definition:true}}}});
  const used=flows.filter((flow:any)=>{
    const nodes=(flow.activeVersion?.definition as any)?.nodes;
    return Array.isArray(nodes)&&nodes.some((node:any)=>node?.kind==='kanban'&&((target.columnId&&node.config?.columnId===target.columnId)||(target.boardId&&node.config?.boardId===target.boardId)));
  });
  if(used.length)throw new DomainError('KANBAN_IN_USE_BY_FLOW',`Não dá para excluir: usado por fluxo publicado (${used.map((flow:any)=>flow.name).join(', ')}). Ajuste ou despublique o fluxo antes.`,409,{flows:used.map((flow:any)=>({id:flow.id,name:flow.name}))});
}

export async function relocateAndDeleteColumn(prisma:any,input:{workspaceId:string;columnId:string;destinationColumnId?:string;actor:KanbanActor}){
  return prisma.$transaction(async(tx:any)=>{
    const column=await tx.kanbanColumn.findFirst({where:{id:input.columnId,board:{workspaceId:input.workspaceId}},include:{_count:{select:{cards:true}}}});
    if(!column)throw new DomainError('NOT_FOUND','Coluna não encontrada.',404);
    await assertNotUsedByPublishedFlow(tx,input.workspaceId,{columnId:column.id});
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

const cardInclude={contact:{select:{id:true,name:true,phone:true,tags:{include:{tag:true},orderBy:{tag:{name:'asc' as const}}}}},conversation:{select:{id:true,status:true,updatedAt:true}}};

/** Cria o cartão de um contato do workspace (um por contato por quadro), no fim da coluna; registra evento e auditoria. */
export async function createKanbanCard(prisma:any,input:{workspaceId:string;boardId:string;contactId:string;columnId?:string;title?:string;note?:string;actor:KanbanActor;ip?:string}){
  try{
    return await prisma.$transaction(async(tx:any)=>{
      const board=await tx.kanbanBoard.findFirst({where:{id:input.boardId,workspaceId:input.workspaceId},select:{id:true}});
      if(!board)throw new DomainError('NOT_FOUND','Quadro não encontrado.',404);
      const contact=await tx.contact.findFirst({where:{id:input.contactId,workspaceId:input.workspaceId},select:{id:true}});
      if(!contact)throw new DomainError('CONTACT_NOT_FOUND','Contato não encontrado.',404);
      const column=input.columnId
        ?await tx.kanbanColumn.findFirst({where:{id:input.columnId,boardId:board.id},select:{id:true}})
        :await tx.kanbanColumn.findFirst({where:{boardId:board.id},orderBy:[{position:'asc'},{createdAt:'asc'}],select:{id:true}});
      if(!column)throw new DomainError('KANBAN_COLUMN_INVALID',input.columnId?'A coluna não pertence a este quadro.':'O quadro não tem colunas.',422);
      const existing=await tx.kanbanCard.findUnique({where:{boardId_contactId:{boardId:board.id,contactId:contact.id}},select:{id:true,columnId:true}});
      if(existing)throw new DomainError('KANBAN_CARD_EXISTS','Este contato já tem um cartão neste quadro.',409,{cardId:existing.id,columnId:existing.columnId});
      const position=((await tx.kanbanCard.aggregate({where:{columnId:column.id},_max:{position:true}}))._max.position??-1)+1;
      const card=await tx.kanbanCard.create({data:{boardId:board.id,columnId:column.id,contactId:contact.id,title:input.title??null,note:input.note??null,position,movedByType:input.actor.type,movedById:input.actor.id},include:cardInclude});
      await tx.kanbanCardEvent.create({data:{cardId:card.id,toColumnId:column.id,movedByType:input.actor.type,movedById:input.actor.id}});
      await audit(tx,{workspaceId:input.workspaceId,actorId:input.actor.id,action:'kanban.card_created',targetType:'KanbanCard',targetId:card.id,changes:{boardId:board.id,columnId:column.id,contactId:contact.id,position},ip:input.ip});
      return card;
    });
  }catch(error:any){
    if(error?.code==='P2002'){const existing=await prisma.kanbanCard.findUnique({where:{boardId_contactId:{boardId:input.boardId,contactId:input.contactId}},select:{id:true,columnId:true}});throw new DomainError('KANBAN_CARD_EXISTS','Este contato já tem um cartão neste quadro.',409,{cardId:existing?.id??null,columnId:existing?.columnId??null})}
    throw error;
  }
}

/** Remove o cartão do workspace e fecha o buraco de posições. O histórico (KanbanCardEvent) cai em cascata com o cartão; a trilha permanente fica na auditoria. */
export async function deleteKanbanCard(prisma:any,input:{workspaceId:string;cardId:string;actor:KanbanActor;ip?:string}){
  return prisma.$transaction(async(tx:any)=>{
    const card=await tx.kanbanCard.findFirst({where:{id:input.cardId,board:{workspaceId:input.workspaceId}}});
    if(!card)throw new DomainError('NOT_FOUND','Card não encontrado.',404);
    await tx.kanbanCard.delete({where:{id:card.id}});
    await tx.kanbanCard.updateMany({where:{columnId:card.columnId,position:{gt:card.position}},data:{position:{decrement:1}}});
    await audit(tx,{workspaceId:input.workspaceId,actorId:input.actor.id,action:'kanban.card_deleted',targetType:'KanbanCard',targetId:card.id,changes:{boardId:card.boardId,columnId:card.columnId,contactId:card.contactId,position:card.position},ip:input.ip});
  });
}
