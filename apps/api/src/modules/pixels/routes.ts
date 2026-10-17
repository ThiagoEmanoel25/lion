import type {FastifyPluginAsync} from 'fastify';
import {MetaPixelInput,UpdateMetaPixelInput} from '@nexo/contracts';
import {DomainError} from '@nexo/domain';
import {audit} from '../../core/audit.js';
import {encryptWebhookSecret} from '../webhooks/generic.js';
import {keyLast4} from '../workspaces/settings.js';

type Row={id:string;name:string;pixelId:string;pageId:string|null;testEventCode:string|null;accessTokenLast4:string};
const view=(row:Row)=>({id:row.id,name:row.name,pixelId:row.pixelId,pageId:row.pageId,testEventCode:row.testEventCode,tokenLast4:row.accessTokenLast4});
const duplicate=(error:any)=>{if(error?.code==='P2002')throw new DomainError('PIXEL_EXISTS','Já existe um pixel com este nome.',409);throw error};

export const pixelRoutes:FastifyPluginAsync=async app=>{
  const guard={preHandler:[app.requirePermission('workspace.manage')]};
  const find=async(workspaceId:string,id:string)=>{const row=await app.prisma.metaPixel.findFirst({where:{id,workspaceId}});if(!row)throw new DomainError('NOT_FOUND','Pixel não encontrado.',404);return row};
  app.get('/v1/workspace/pixels',guard,async request=>(await app.prisma.metaPixel.findMany({where:{workspaceId:request.auth.workspaceId},orderBy:{name:'asc'}})).map(view));
  app.post('/v1/workspace/pixels',guard,async(request,reply)=>{const {accessToken,...input}=MetaPixelInput.parse(request.body);const row=await app.prisma.metaPixel.create({data:{...input,workspaceId:request.auth.workspaceId,accessTokenEncrypted:encryptWebhookSecret(accessToken),accessTokenLast4:keyLast4(accessToken)}}).catch(duplicate);await audit(app.prisma,{workspaceId:request.auth.workspaceId,actorId:request.auth.userId,action:'pixel.created',targetType:'MetaPixel',targetId:row.id,changes:{name:row.name,pixelId:row.pixelId},ip:request.ip});return reply.status(201).send(view(row))});
  app.patch('/v1/workspace/pixels/:id',guard,async request=>{const {id}=request.params as {id:string};const {accessToken,...input}=UpdateMetaPixelInput.parse(request.body);await find(request.auth.workspaceId,id);const row=await app.prisma.metaPixel.update({where:{id},data:{...input,...(accessToken?{accessTokenEncrypted:encryptWebhookSecret(accessToken),accessTokenLast4:keyLast4(accessToken)}:{})}}).catch(duplicate);await audit(app.prisma,{workspaceId:request.auth.workspaceId,actorId:request.auth.userId,action:'pixel.updated',targetType:'MetaPixel',targetId:id,changes:{...input,tokenChanged:Boolean(accessToken)},ip:request.ip});return view(row)});
  app.delete('/v1/workspace/pixels/:id',guard,async(request,reply)=>{const {id}=request.params as {id:string};await find(request.auth.workspaceId,id);await app.prisma.metaPixel.delete({where:{id}});await audit(app.prisma,{workspaceId:request.auth.workspaceId,actorId:request.auth.userId,action:'pixel.deleted',targetType:'MetaPixel',targetId:id,ip:request.ip});return reply.status(204).send()});
};
