import type {FastifyPluginAsync} from 'fastify';
import type {Prisma} from '@prisma/client';
import {z} from 'zod';
import {DomainError} from '@nexo/domain';
import {audit} from '../../core/audit.js';

const slots=z.object({
  WELCOME:z.string().cuid().nullable(),
  DEFAULT_RESPONSE:z.string().cuid().nullable(),
  CONVERSATION_RESOLVED:z.string().cuid().nullable(),
  HANDOFF_CLOSED:z.string().cuid().nullable()
});
const keyword=z.object({keyword:z.string().trim().min(1).max(80),match:z.enum(['EXACT','CONTAINS']),playbookId:z.string().cuid()});
const settingsBase=z.object({slots,defaultResponseWindowHours:z.number().int().min(1).max(720).default(24),keywords:z.array(keyword).max(50)});
function uniqueKeywords(value:{keywords:Array<z.infer<typeof keyword>>},ctx:z.RefinementCtx){
  const seen=new Set<string>();
  value.keywords.forEach((item,index)=>{const key=`${item.match}:${normalizeKeyword(item.keyword)}`;if(seen.has(key))ctx.addIssue({code:z.ZodIssueCode.custom,path:['keywords',index,'keyword'],message:'Palavra-chave duplicada neste modo.'});seen.add(key)});
}
const settings=settingsBase.superRefine(uniqueKeywords);
const channelIds=z.array(z.string().cuid()).min(1).max(100).refine(ids=>new Set(ids).size===ids.length,'Não repita conexões na aplicação em massa.');
const bulk=settingsBase.extend({channelIds}).superRefine(uniqueKeywords);
type Settings=z.infer<typeof settings>;

export function normalizeKeyword(value:string){return value.trim().toLocaleLowerCase('pt-BR').replace(/\s+/g,' ')}
const include={flowConfigs:{include:{playbook:{select:{id:true,name:true,status:true}}}},keywords:{include:{playbook:{select:{id:true,name:true,status:true}}},orderBy:{createdAt:'asc' as const}}};

async function assertTargets(tx:Prisma.TransactionClient,workspaceId:string,input:Settings){
  const ids=[...Object.values(input.slots),...input.keywords.map(item=>item.playbookId)].filter((id):id is string=>Boolean(id));
  const unique=[...new Set(ids)];if(!unique.length)return;
  const count=await tx.playbook.count({where:{id:{in:unique},workspaceId,status:'PUBLISHED',activeVersionId:{not:null}}});
  if(count!==unique.length)throw new DomainError('PLAYBOOK_NOT_PUBLISHED','Todos os destinos precisam ser fluxos publicados deste workspace.',422);
}
async function replace(tx:Prisma.TransactionClient,workspaceId:string,channelIds:string[],input:Settings){
  await assertTargets(tx,workspaceId,input);
  const channels=await tx.channel.findMany({where:{id:{in:channelIds},workspaceId},select:{id:true}});
  if(channels.length!==channelIds.length)throw new DomainError('CHANNEL_NOT_FOUND','Um ou mais canais não foram encontrados.',404);
  await tx.channelFlowConfig.deleteMany({where:{channelId:{in:channelIds}}});
  await tx.channelKeyword.deleteMany({where:{channelId:{in:channelIds}}});
  const configs=channelIds.flatMap(channelId=>Object.entries(input.slots).flatMap(([slot,playbookId])=>playbookId?[{channelId,slot:slot as keyof Settings['slots'],playbookId,windowHours:slot==='DEFAULT_RESPONSE'?input.defaultResponseWindowHours:24}]:[]));
  if(configs.length)await tx.channelFlowConfig.createMany({data:configs});
  const keywords=channelIds.flatMap(channelId=>input.keywords.map(item=>({channelId,keyword:item.keyword.trim(),normalizedKeyword:normalizeKeyword(item.keyword),match:item.match,playbookId:item.playbookId})));
  if(keywords.length)await tx.channelKeyword.createMany({data:keywords});
  await Promise.all(channelIds.map(channelId=>tx.channel.update({where:{id:channelId},data:{activePlaybookId:input.slots.WELCOME}})));
}

export const channelFlowSettingsRoutes:FastifyPluginAsync=async app=>{
  app.get('/v1/channel-flow-settings',{preHandler:[app.authenticate]},async request=>{
    const [channels,playbooks]=await Promise.all([
      app.prisma.channel.findMany({where:{workspaceId:request.auth.workspaceId},include,orderBy:{displayName:'asc'}}),
      app.prisma.playbook.findMany({where:{workspaceId:request.auth.workspaceId,status:{in:['PUBLISHED','PAUSED']},activeVersionId:{not:null}},select:{id:true,name:true,status:true},orderBy:{name:'asc'}})
    ]);
    return {channels:channels.map(channel=>({id:channel.id,displayName:channel.displayName,phoneNumber:channel.phoneNumber,status:channel.status,flowConfigs:channel.flowConfigs,keywords:channel.keywords})),playbooks};
  });
  app.put('/v1/channels/:id/flow-settings',{preHandler:[app.requirePermission('channel.manage')]},async request=>{
    const {id}=request.params as {id:string};const input=settings.parse(request.body);
    await app.prisma.$transaction(tx=>replace(tx,request.auth.workspaceId,[id],input));
    await audit(app.prisma,{workspaceId:request.auth.workspaceId,actorId:request.auth.userId,action:'channel.flow_settings_changed',targetType:'Channel',targetId:id,changes:{slots:input.slots,keywords:input.keywords.length,defaultResponseWindowHours:input.defaultResponseWindowHours},ip:request.ip});
    return app.prisma.channel.findUnique({where:{id},include});
  });
  app.post('/v1/channel-flow-settings/bulk',{preHandler:[app.requirePermission('channel.manage')]},async request=>{
    const input=bulk.parse(request.body);const {channelIds,...shared}=input;
    await app.prisma.$transaction(tx=>replace(tx,request.auth.workspaceId,channelIds,shared));
    await audit(app.prisma,{workspaceId:request.auth.workspaceId,actorId:request.auth.userId,action:'channel.flow_settings_bulk_changed',targetType:'Channel',changes:{channelIds,slots:shared.slots,keywords:shared.keywords.length},ip:request.ip});
    return {ok:true,updated:channelIds.length};
  });
};
