import type {FastifyPluginAsync} from 'fastify';
import {MetaPixelInput,UpdateMetaPixelInput} from '@nexo/contracts';
import {randomUUID} from 'node:crypto';
import {DomainError,buildPixelEvent,pixelOutcome,pixelRequest} from '@nexo/domain';
import {audit} from '../../core/audit.js';
import {RATE_SCRIPT} from '../playbooks/integration-test.js';
import {decryptWebhookSecret,encryptWebhookSecret} from '../webhooks/generic.js';
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
  // 5 test events per minute per user; same Redis counter pattern as the integration test route.
  app.post('/v1/workspace/pixels/:id/test-event',guard,async request=>{
    const {id}=request.params as {id:string};
    if(Number(await app.redis.eval(RATE_SCRIPT,1,`rate:pixel-test:${request.auth.userId}:${Math.floor(Date.now()/60_000)}`,70))>5)throw new DomainError('RATE_LIMITED','Limite de 5 testes por minuto excedido.',429);
    const pixel=await app.prisma.metaPixel.findFirst({where:{id,workspaceId:request.auth.workspaceId},omit:{accessTokenEncrypted:false}});
    if(!pixel)throw new DomainError('NOT_FOUND','Pixel não encontrado.',404);
    if(!pixel.testEventCode)throw new DomainError('PIXEL_TEST_CODE_REQUIRED','Informe o código de teste de eventos do pixel para enviar um teste.',422);
    let token:string;try{token=decryptWebhookSecret(pixel.accessTokenEncrypted)}catch{throw new DomainError('PIXEL_TOKEN_UNREADABLE','Não foi possível ler o token do pixel. Cadastre o token novamente.',422)}
    const req=pixelRequest(pixel.pixelId,token,buildPixelEvent({eventName:'Purchase',eventTime:Math.floor(Date.now()/1000),eventId:randomUUID(),ctwaClid:'TEST_CTWA_CLID',...(pixel.pageId?{pageId:pixel.pageId}:{}),value:1,currency:'BRL'}),pixel.testEventCode);
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30_000);
    let status:number|null=null,body:unknown=null,error:string|undefined;
    try{const response=await fetch(req.url,{method:'POST',headers:{'content-type':'application/json'},body:req.body,redirect:'manual',signal:controller.signal});status=response.status;const text=(await response.text()).slice(0,10_000);try{body=JSON.parse(text)}catch{body=text}}
    catch(caught){error=caught instanceof Error&&caught.name==='AbortError'?'A Meta não respondeu em 30 segundos.':'Não foi possível conectar à Meta.'}finally{clearTimeout(timer)}
    const outcome=pixelOutcome(status,body,error);const received=(body as {events_received?:unknown}|null)?.events_received;
    return {ok:outcome.port==='success',status,eventsReceived:typeof received==='number'?received:0,message:outcome.error?.message??'Evento de teste recebido pela Meta. Confira em Gerenciador de Eventos > Testar eventos.'};
  });
};
