import type {FastifyPluginAsync} from 'fastify';
import {z} from 'zod';
import {BROADCAST_LIMITS,DomainError,broadcastPacingIssue,planBroadcastSchedule} from '@nexo/domain';
import {audit} from '../../core/audit.js';

const AudienceInput=z.object({
  tagIds:z.array(z.string().cuid()).max(20).default([]),
  stages:z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  contactIds:z.array(z.string().cuid()).max(BROADCAST_LIMITS.maxRecipients).default([])
});
const BroadcastInput=z.object({
  name:z.string().trim().min(2).max(120),
  channelId:z.string().cuid(),
  body:z.string().trim().min(1).max(4096),
  startAt:z.string().datetime({offset:true}).transform(value=>new Date(value)),
  minIntervalSeconds:z.number().int().default(45),
  maxIntervalSeconds:z.number().int().default(180),
  dailyQuota:z.number().int().default(200),
  audience:AudienceInput
});

// Opt-in é regra, não opção: o disparo só alcança quem registrou consentimento e não pediu para sair.
// Um contato sem consentAt fica fora e aparece na contagem de ignorados, para o motivo ser visível.
const audienceWhere=(workspaceId:string,audience:z.output<typeof AudienceInput>)=>({
  workspaceId,
  ...(audience.contactIds.length?{id:{in:audience.contactIds}}:{}),
  ...(audience.tagIds.length?{tags:{some:{tagId:{in:audience.tagIds}}}}:{}),
  ...(audience.stages.length?{stage:{in:audience.stages}}:{})
});

const progress=(recipients:Array<{status:string}>)=>({
  total:recipients.length,
  sent:recipients.filter(item=>item.status==='SENT').length,
  pending:recipients.filter(item=>item.status==='PENDING').length,
  failed:recipients.filter(item=>item.status==='FAILED').length,
  cancelled:recipients.filter(item=>item.status==='CANCELLED').length
});

export const broadcastRoutes:FastifyPluginAsync=async app=>{
  app.get('/v1/broadcasts',{preHandler:[app.requirePermission('conversation.read')]},async request=>{
    const rows=await app.prisma.broadcast.findMany({
      where:{workspaceId:request.auth.workspaceId},
      orderBy:{createdAt:'desc'},take:50,
      include:{channel:{select:{id:true,displayName:true}},recipients:{select:{status:true}}}
    });
    return rows.map(({recipients,...row})=>({...row,progress:progress(recipients)}));
  });

  // Prévia antes de disparar: quantos entram, quantos ficam fora e por quê. Sem isso ninguém
  // descobre que metade da base não deu consentimento a não ser depois do envio.
  app.post('/v1/broadcasts/preview',{preHandler:[app.requirePermission('conversation.reply')]},async request=>{
    const audience=AudienceInput.parse((request.body as {audience?:unknown})?.audience??request.body);
    const where=audienceWhere(request.auth.workspaceId,audience);
    const [matched,eligible,noConsent,optedOut]=await Promise.all([
      app.prisma.contact.count({where}),
      app.prisma.contact.count({where:{...where,consentAt:{not:null},optedOutAt:null}}),
      app.prisma.contact.count({where:{...where,consentAt:null}}),
      app.prisma.contact.count({where:{...where,optedOutAt:{not:null}}})
    ]);
    return {matched,eligible,skipped:{noConsent,optedOut},limit:BROADCAST_LIMITS.maxRecipients};
  });

  app.post('/v1/broadcasts',{preHandler:[app.requirePermission('workspace.manage')]},async(request,reply)=>{
    const input=BroadcastInput.parse(request.body);
    const pacingIssue=broadcastPacingIssue(input);
    if(pacingIssue)throw new DomainError('INVALID_PACING',pacingIssue,422);
    if(input.startAt.getTime()<Date.now()-60_000)throw new DomainError('INVALID_SCHEDULE','O início não pode estar no passado.',422);
    const channel=await app.prisma.channel.findFirst({where:{id:input.channelId,workspaceId:request.auth.workspaceId},select:{id:true,status:true}});
    if(!channel)throw new DomainError('NOT_FOUND','Conexão não encontrada.',404);
    if(channel.status!=='CONNECTED')throw new DomainError('CHANNEL_UNAVAILABLE','A conexão precisa estar conectada para criar um disparo.',409);
    const contacts=await app.prisma.contact.findMany({
      where:{...audienceWhere(request.auth.workspaceId,input.audience),consentAt:{not:null},optedOutAt:null},
      select:{id:true},orderBy:{createdAt:'asc'},take:BROADCAST_LIMITS.maxRecipients
    });
    if(!contacts.length)throw new DomainError('EMPTY_AUDIENCE','Nenhum contato com consentimento registrado corresponde a esse público.',422);
    const schedule=planBroadcastSchedule(contacts.length,{startAt:input.startAt,minIntervalSeconds:input.minIntervalSeconds,maxIntervalSeconds:input.maxIntervalSeconds,dailyQuota:input.dailyQuota});
    const created=await app.prisma.$transaction(async tx=>{
      const broadcast=await tx.broadcast.create({data:{
        workspaceId:request.auth.workspaceId,channelId:input.channelId,name:input.name,body:input.body,
        minIntervalSeconds:input.minIntervalSeconds,maxIntervalSeconds:input.maxIntervalSeconds,dailyQuota:input.dailyQuota,
        startAt:input.startAt,createdById:request.auth.userId
      }});
      await tx.broadcastRecipient.createMany({data:contacts.map((contact,index)=>({broadcastId:broadcast.id,contactId:contact.id,scheduledFor:schedule[index]!}))});
      return broadcast;
    });
    await audit(app.prisma,{workspaceId:request.auth.workspaceId,actorId:request.auth.userId,action:'broadcast.create',targetType:'Broadcast',targetId:created.id,changes:{name:created.name,recipients:contacts.length}});
    reply.code(201);
    return {...created,progress:{total:contacts.length,sent:0,pending:contacts.length,failed:0,cancelled:0}};
  });

  app.get('/v1/broadcasts/:id',{preHandler:[app.requirePermission('conversation.read')]},async request=>{
    const {id}=request.params as {id:string};
    const row=await app.prisma.broadcast.findFirst({
      where:{id,workspaceId:request.auth.workspaceId},
      include:{channel:{select:{id:true,displayName:true}},recipients:{select:{status:true}}}
    });
    if(!row)throw new DomainError('NOT_FOUND','Disparo não encontrado.',404);
    const {recipients,...broadcast}=row;
    return {...broadcast,progress:progress(recipients)};
  });

  // Começar cria um evento por destinatário com availableAt no horário planejado: o relay do runtime
  // já sabe entregar, retentar e respeitar cancelamento, então não existe fila paralela aqui.
  app.post('/v1/broadcasts/:id/start',{preHandler:[app.requirePermission('workspace.manage')]},async request=>{
    const {id}=request.params as {id:string};
    const broadcast=await app.prisma.broadcast.findFirst({where:{id,workspaceId:request.auth.workspaceId}});
    if(!broadcast)throw new DomainError('NOT_FOUND','Disparo não encontrado.',404);
    if(!['DRAFT','PAUSED'].includes(broadcast.status))throw new DomainError('INVALID_STATE','Só um disparo em rascunho ou pausado pode ser iniciado.',409);
    const channel=await app.prisma.channel.findFirst({where:{id:broadcast.channelId,workspaceId:broadcast.workspaceId},select:{status:true}});
    if(channel?.status!=='CONNECTED')throw new DomainError('CHANNEL_UNAVAILABLE','A conexão está desconectada.',409);
    await app.prisma.$transaction(async tx=>{
      const pending=await tx.broadcastRecipient.findMany({where:{broadcastId:id,status:'PENDING'},select:{id:true,scheduledFor:true}});
      await tx.broadcast.update({where:{id},data:{status:'RUNNING',startedAt:broadcast.startedAt??new Date()}});
      for(const recipient of pending)await tx.outboxEvent.create({data:{
        workspaceId:broadcast.workspaceId,aggregate:'BroadcastRecipient',aggregateId:recipient.id,
        type:'broadcast.recipient.requested',availableAt:recipient.scheduledFor,payload:{recipientId:recipient.id}
      }});
    });
    await audit(app.prisma,{workspaceId:request.auth.workspaceId,actorId:request.auth.userId,action:'broadcast.start',targetType:'Broadcast',targetId:id,changes:{recipients:'pending'}});
    return {ok:true};
  });

  // Pausar e cancelar fecham os eventos ainda não entregues, do mesmo jeito que o cancelamento de
  // mensagem agendada: um envio em voo não volta atrás, mas nenhum novo sai.
  const halt=(status:'PAUSED'|'CANCELLED')=>async(request:{params:unknown;auth:{workspaceId:string;userId:string}})=>{
    const {id}=request.params as {id:string};
    const broadcast=await app.prisma.broadcast.findFirst({where:{id,workspaceId:request.auth.workspaceId}});
    if(!broadcast)throw new DomainError('NOT_FOUND','Disparo não encontrado.',404);
    if(['DONE','CANCELLED'].includes(broadcast.status))throw new DomainError('INVALID_STATE','Este disparo já terminou.',409);
    await app.prisma.$transaction(async tx=>{
      await tx.broadcast.update({where:{id},data:{status,...(status==='CANCELLED'?{finishedAt:new Date()}:{})}});
      await tx.outboxEvent.updateMany({where:{aggregate:'BroadcastRecipient',type:'broadcast.recipient.requested',processedAt:null,aggregateId:{in:(await tx.broadcastRecipient.findMany({where:{broadcastId:id,status:'PENDING'},select:{id:true}})).map(item=>item.id)}},data:{processedAt:new Date()}});
      if(status==='CANCELLED')await tx.broadcastRecipient.updateMany({where:{broadcastId:id,status:'PENDING'},data:{status:'CANCELLED',reason:'Disparo cancelado.'}});
    });
    await audit(app.prisma,{workspaceId:request.auth.workspaceId,actorId:request.auth.userId,action:status==='PAUSED'?'broadcast.pause':'broadcast.cancel',targetType:'Broadcast',targetId:id,changes:{status}});
    return {ok:true};
  };
  app.post('/v1/broadcasts/:id/pause',{preHandler:[app.requirePermission('workspace.manage')]},halt('PAUSED'));
  app.post('/v1/broadcasts/:id/cancel',{preHandler:[app.requirePermission('workspace.manage')]},halt('CANCELLED'));
};
