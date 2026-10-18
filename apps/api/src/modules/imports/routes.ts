import {createHash,randomBytes} from 'node:crypto';
import type {FastifyInstance,FastifyPluginAsync} from 'fastify';
import type {Prisma,PrismaClient} from '@prisma/client';
import {AutomationDefinitionSchema,ImportNexoShareInput,LEONA_IMPORT_CODE_TTL_SECONDS,LEONA_IMPORT_MAX_BYTES,LeonaImportPayloadSchema,NEXO_SHARE_CODE_TTL_DAYS} from '@nexo/contracts';
import {DomainError} from '@nexo/domain';
import {audit} from '../../core/audit.js';
import {convertLeonaFlow,redactDefinitionSecrets,type ImportReport} from './converter.js';
import {validateAutomation,type AutomationIssue} from '../playbooks/compiler.js';

const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const json=(value:unknown)=>value as Prisma.InputJsonValue;
const checksum=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const code=(length:number)=>Array.from(randomBytes(length),byte=>alphabet[byte%alphabet.length]).join('');
const totals=(items:ImportReport['items'])=>({converted:items.filter(item=>item.status==='converted').length,adjusted:items.filter(item=>item.status==='adjusted').length,pending:items.filter(item=>item.status==='pending').length});
const importGuidance='Para resolver os saltos automaticamente, importe os funis do último para o primeiro (por exemplo: 05 → 01).';
export const parseLeonaImportRequest=(value:unknown)=>LeonaImportPayloadSchema.parse(value);
export const leonaImportSource=(sourceFlowId:string|number|undefined):Prisma.InputJsonValue|undefined=>sourceFlowId===undefined?undefined:json({system:'leona',flowId:sourceFlowId});

async function uniqueCode(prisma:PrismaClient,kind:'session'|'share',length:number){
  for(let attempt=0;attempt<8;attempt++){const candidate=code(length);const found=kind==='session'?await prisma.flowImportSession.count({where:{code:candidate}}):await prisma.flowShareCode.count({where:{code:candidate}});if(!found)return candidate}
  throw new DomainError('CODE_GENERATION_FAILED','Não foi possível gerar um código agora. Tente novamente.',503);
}

async function rateLimit(app:FastifyInstance,ip:string,importCode:string){
  const window=Math.floor(Date.now()/900_000);const ipKey=`flow-import:ip:${ip}:${window}`;const codeKey=`flow-import:code:${importCode}:${window}`;
  const [ipCount,codeCount]=await Promise.all([app.redis.incr(ipKey),app.redis.incr(codeKey)]);if(ipCount===1)await app.redis.expire(ipKey,900);if(codeCount===1)await app.redis.expire(codeKey,900);
  if(ipCount>30||codeCount>5)throw new DomainError('IMPORT_RATE_LIMIT','Muitas tentativas de importação. Aguarde alguns minutos.',429);
}

export async function resolveTags(tx:Prisma.TransactionClient,workspaceId:string,definition:ReturnType<typeof convertLeonaFlow>['definition'],report:ImportReport){
  const resolve=async(name:string,sourceId:string)=>{const clean=name.trim();let tag=await tx.tag.findUnique({where:{workspaceId_name:{workspaceId,name:clean}}});if(!tag){tag=await tx.tag.create({data:{workspaceId,name:clean}});report.items.push({sourceId,sourceType:'tags',status:'adjusted',message:`Etiqueta “${clean}” criada no workspace.`})}return tag.id};
  for(const node of definition.nodes.filter(item=>item.kind==='tag')){
    const names=Array.isArray(node.config.tags)?node.config.tags.filter((item):item is string=>typeof item==='string'&&Boolean(item.trim())):[];if(!names.length)continue;
    const uniqueNames=[...new Set(names.map(name=>name.trim()))];const ids:string[]=[];
    for(const name of uniqueNames)ids.push(await resolve(name,node.id));
    node.config={...node.config,tagIds:ids,tags:uniqueNames};
  }
  for(const node of definition.nodes.filter(item=>item.kind==='condition')){
    const rules=Array.isArray(node.config.rules)?node.config.rules:[];
    for(const rule of rules){if(!rule||typeof rule!=='object'||(rule as {field?:unknown}).field!=='contact.tagIds')continue;const record=rule as {value?:unknown};const names=(Array.isArray(record.value)?record.value:[]).filter((item):item is string=>typeof item==='string'&&Boolean(item.trim()));const ids:string[]=[];for(const name of [...new Set(names)])ids.push(await resolve(name,node.id));record.value=ids}
  }
  report.totals=totals(report.items);
}

async function resolveKanban(tx:Prisma.TransactionClient,workspaceId:string,definition:ReturnType<typeof convertLeonaFlow>['definition'],report:ImportReport){
  for(const node of definition.nodes.filter(item=>item.kind==='kanban')){
    const boardName=typeof node.config.boardName==='string'?node.config.boardName.trim():'';const columnName=typeof node.config.columnName==='string'?node.config.columnName.trim():'';
    if(!boardName||!columnName)continue;
    const existingBoard=await tx.kanbanBoard.findUnique({where:{workspaceId_name:{workspaceId,name:boardName}}});
    const board=existingBoard??await tx.kanbanBoard.create({data:{workspaceId,name:boardName,position:await tx.kanbanBoard.count({where:{workspaceId}})}});
    if(!existingBoard)report.items.push({sourceId:node.id,sourceType:'kanban',status:'adjusted',message:`Quadro “${boardName}” criado no workspace.`});
    const existingColumn=await tx.kanbanColumn.findUnique({where:{boardId_name:{boardId:board.id,name:columnName}}});
    const column=existingColumn??await tx.kanbanColumn.create({data:{boardId:board.id,name:columnName,position:await tx.kanbanColumn.count({where:{boardId:board.id}})}});
    if(!existingColumn)report.items.push({sourceId:node.id,sourceType:'kanban',status:'adjusted',message:`Coluna “${columnName}” criada no quadro “${boardName}”.`});
    const mode=['create_only','move_only','create_or_move'].includes(String(node.config.mode))?String(node.config.mode):'create_or_move';
    node.config={boardId:board.id,columnId:column.id,mode};
  }
  report.totals=totals(report.items);
}

// Never trusts an incoming pixelId (a share code may carry another workspace's id): resolves by name in the importing workspace.
export async function resolvePixels(tx:Prisma.TransactionClient,workspaceId:string,definition:ReturnType<typeof convertLeonaFlow>['definition'],report:ImportReport){
  for(const node of definition.nodes.filter(item=>item.kind==='pixel')){
    const {pixelId:_untrusted,pixelName,...rest}=node.config;const name=typeof pixelName==='string'?pixelName.trim():'';
    const pixel=name?await tx.metaPixel.findFirst({where:{workspaceId,name},select:{id:true}}):null;
    node.config=pixel?{...rest,pixelId:pixel.id}:rest;
    report.items.push(pixel?{sourceId:node.id,sourceType:'pixel',status:'converted',message:`Bloco “${node.name}” ligado ao pixel ‘${name}’.`}:{sourceId:node.id,sourceType:'pixel',status:'pending',message:name?`Configure o pixel ‘${name}’ em Configurações.`:'Selecione o pixel do bloco após importar.'});
  }
  report.totals=totals(report.items);
}

const importSourceOf=(value:unknown)=>value&&typeof value==='object'&&!Array.isArray(value)?value as {system?:unknown;flowId?:unknown}:{};
export async function resolveFlowJumps(tx:Prisma.TransactionClient,workspaceId:string,definition:ReturnType<typeof convertLeonaFlow>['definition'],report:ImportReport){
  const nodes=definition.nodes.filter(item=>item.kind==='flow_jump');if(!nodes.length)return;
  const playbooks=await tx.playbook.findMany({where:{workspaceId},select:{id:true,name:true,importSource:true}});
  for(const node of nodes){
    if(typeof node.config.targetPlaybookId==='string'&&node.config.targetPlaybookId)continue;
    const leonaFlowId=node.config.leonaFlowId;const targetName=typeof node.config.targetName==='string'?node.config.targetName.trim():'';
    const bySource=leonaFlowId===undefined?undefined:playbooks.find(playbook=>{const source=importSourceOf(playbook.importSource);return source.system==='leona'&&String(source.flowId)===String(leonaFlowId)});
    const byName=targetName?playbooks.find(playbook=>playbook.name.localeCompare(targetName,undefined,{sensitivity:'accent'})===0):undefined;
    const target=bySource??byName;
    report.items=report.items.filter(item=>!(item.status==='pending'&&['connection_flow','execute_flow'].includes(item.sourceType??'')&&item.message.startsWith('Destino da Leona')&&(!targetName||item.message.toLocaleLowerCase().includes(targetName.toLocaleLowerCase()))));
    if(target){node.config={targetPlaybookId:target.id};report.items.push({sourceId:node.id,sourceType:'connection_flow',status:'adjusted',message:`Salto ligado ao fluxo “${target.name}”.`})}
    else report.items.push({sourceId:node.id,sourceType:'connection_flow',status:'pending',message:targetName?`Importe “${targetName}” primeiro ou selecione o fluxo correspondente.`:'Selecione o fluxo de destino deste salto.'});
  }
  report.totals=totals(report.items);
}

// Lists everything that still blocks publishing, so the report never hides a compiler error.
export function reportCompilerIssues(definition:ReturnType<typeof convertLeonaFlow>['definition'],report:ImportReport){
  for(const issue of validateAutomation(definition).issues as AutomationIssue[]){
    if(issue.level!=='error')continue;const sourceId=issue.nodeId??issue.edgeId;
    // resolvePixels already asked to configure this pixel; the missing pixelId is the same pending item.
    if((issue.code==='INVALID_PIXEL_CONFIG'||issue.code==='FLOW_JUMP_TARGET_REQUIRED')&&report.items.some(item=>item.status==='pending'&&item.sourceId===sourceId))continue;
    report.items.push({...(sourceId?{sourceId}:{}),sourceType:'compiler',status:'pending',message:issue.message.slice(0,500)});
  }
  report.totals=totals(report.items);
}

async function createImportedPlaybook(tx:Prisma.TransactionClient,input:{workspaceId:string;userId:string;name:string;definition:ReturnType<typeof AutomationDefinitionSchema.parse>;importSource?:Prisma.InputJsonValue}){
  return tx.playbook.create({data:{workspaceId:input.workspaceId,name:input.name,description:'Importado como rascunho. Revise as pendências antes de publicar.',status:'DRAFT',...(input.importSource?{importSource:input.importSource}:{}),versions:{create:{version:1,definition:json(input.definition),checksum:checksum(input.definition),createdById:input.userId}}},include:{versions:true}});
}

export function bookmarklet(apiOrigin:string){
  const endpoint=`${apiOrigin.replace(/\/$/,'')}/v1/imports/leona/`;
  const script=`(()=>{const c=prompt('Código de importação do Nexo');if(!c)return;let f=window.__NEXO_LEONA_EXPORT__||window.__LEONA_FLOW__;if(!f){const el=document.querySelector('.react-flow');const k=el&&Object.keys(el).find(x=>x.startsWith('__reactFiber$'));const seen=new Set(),q=k?[el[k]]:[];while(q.length&&!f){const x=q.shift();if(!x||seen.has(x))continue;seen.add(x);const p=x.memoizedProps||x.pendingProps;if(p&&Array.isArray(p.nodes)&&Array.isArray(p.edges))f={nodes:p.nodes,edges:p.edges,label:document.title};q.push(x.child,x.sibling)}}if(!f)for(let i=0;i<localStorage.length;i++){try{const v=JSON.parse(localStorage.getItem(localStorage.key(i)));const q=[v];while(q.length){const x=q.shift();if(x&&Array.isArray(x.nodes)&&Array.isArray(x.edges)){f=x;break}if(x&&typeof x==='object')q.push(...Object.values(x))}if(f)break}catch{}}if(!f||!Array.isArray(f.nodes)||!Array.isArray(f.edges))return alert('Abra um fluxo no editor da Leona.');const sourceFlowId=f.sourceFlowId||((location.pathname.match(/\\/flows\\/(\\d+)/)||[])[1]);fetch('${endpoint}'+encodeURIComponent(c.trim()),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:'leona',version:1,nodes:f.nodes,edges:f.edges,label:f.label||document.title,...(sourceFlowId?{sourceFlowId}:{})})}).then(async r=>{const x=await r.json().catch(()=>({}));if(!r.ok)throw new Error(x.message||'Falha ao exportar');alert('Fluxo enviado ao Nexo.')}).catch(e=>alert(e.message))})()`;
  return `javascript:${encodeURIComponent(script)}`;
}

export const importRoutes:FastifyPluginAsync=async app=>{
  app.post('/v1/imports/leona/sessions',{preHandler:[app.requirePermission('playbook.write')]},async(request,reply)=>{
    const importCode=await uniqueCode(app.prisma,'session',8);const expiresAt=new Date(Date.now()+LEONA_IMPORT_CODE_TTL_SECONDS*1000);
    await app.prisma.flowImportSession.create({data:{code:importCode,workspaceId:request.auth.workspaceId,createdById:request.auth.userId,expiresAt}});
    const apiOrigin=process.env.PUBLIC_API_URL??`${request.protocol}://${request.host}`;
    return reply.status(201).send({code:importCode,expiresAt,bookmarklet:bookmarklet(apiOrigin),guidance:importGuidance});
  });

  app.get('/v1/imports/leona/sessions/:code',{preHandler:[app.requirePermission('playbook.write')]},async request=>{
    const {code:raw}=request.params as {code:string};const session=await app.prisma.flowImportSession.findFirst({where:{code:raw.toUpperCase(),workspaceId:request.auth.workspaceId}});
    if(!session)throw new DomainError('IMPORT_NOT_FOUND','Importação não encontrada.',404);
    const status=session.status==='WAITING'&&session.expiresAt<=new Date()?'EXPIRED':session.status;
    return {code:session.code,status,expiresAt:session.expiresAt,usedAt:session.usedAt,playbookId:session.playbookId,report:session.report};
  });

  app.options('/v1/imports/leona/:code',{config:{cors:{origin:'https://app.leonasolutions.io',credentials:false}}},async(_,reply)=>reply.status(204).send());
  app.post('/v1/imports/leona/:code',{bodyLimit:LEONA_IMPORT_MAX_BYTES,config:{cors:{origin:'https://app.leonasolutions.io',credentials:false}}},async(request,reply)=>{
    const {code:raw}=request.params as {code:string};const importCode=raw.trim().toUpperCase();await rateLimit(app,request.ip,importCode);const input=parseLeonaImportRequest(request.body);
    const existing=await app.prisma.flowImportSession.findUnique({where:{code:importCode}});
    if(!existing||existing.status!=='WAITING'||existing.usedAt||existing.expiresAt<=new Date())throw new DomainError('IMPORT_CODE_INVALID','Código inválido, expirado ou já utilizado.',410);
    const converted=convertLeonaFlow(input);
    await app.prisma.$transaction(async tx=>{
      const claimed=await tx.flowImportSession.updateMany({where:{id:existing.id,status:'WAITING',usedAt:null,expiresAt:{gt:new Date()}},data:{status:'PROCESSING',usedAt:new Date()}});
      if(claimed.count!==1)throw new DomainError('IMPORT_CODE_INVALID','Código inválido, expirado ou já utilizado.',410);
      await resolveTags(tx,existing.workspaceId,converted.definition,converted.report);
      await resolveKanban(tx,existing.workspaceId,converted.definition,converted.report);
      await resolvePixels(tx,existing.workspaceId,converted.definition,converted.report);
      await resolveFlowJumps(tx,existing.workspaceId,converted.definition,converted.report);
      reportCompilerIssues(converted.definition,converted.report);
      const importSource=leonaImportSource(input.sourceFlowId);const playbook=await createImportedPlaybook(tx,{workspaceId:existing.workspaceId,userId:existing.createdById,name:converted.suggestedName,definition:converted.definition,...(importSource?{importSource}:{})});
      await tx.flowImportSession.update({where:{id:existing.id},data:{status:'COMPLETED',playbookId:playbook.id,report:json(converted.report)}});
      await audit(tx,{workspaceId:existing.workspaceId,actorId:existing.createdById,action:'playbook.imported_from_leona',targetType:'Playbook',targetId:playbook.id,changes:{report:converted.report.totals}});
      return playbook;
    });
    return reply.status(201).send({ok:true});
  });

  app.post('/v1/playbooks/:id/share-codes',{preHandler:[app.requirePermission('playbook.write')]},async(request,reply)=>{
    const {id}=request.params as {id:string};const playbook=await app.prisma.playbook.findFirst({where:{id,workspaceId:request.auth.workspaceId},include:{versions:{orderBy:{version:'desc'},take:1}}});
    if(!playbook||!playbook.versions[0])throw new DomainError('NOT_FOUND','Fluxo não encontrado.',404);
    const parsed=AutomationDefinitionSchema.parse(playbook.versions[0].definition);
    const tagIds=parsed.nodes.flatMap(node=>node.kind==='tag'?(Array.isArray(node.config.tagIds)?node.config.tagIds.filter((item):item is string=>typeof item==='string'):[]):node.kind==='condition'&&Array.isArray(node.config.rules)?node.config.rules.flatMap(rule=>rule&&typeof rule==='object'&&(rule as {field?:unknown}).field==='contact.tagIds'&&Array.isArray((rule as {value?:unknown}).value)?(rule as {value:string[]}).value:[]):[]);
    const tags=tagIds.length?await app.prisma.tag.findMany({where:{workspaceId:request.auth.workspaceId,id:{in:tagIds}},select:{id:true,name:true}}):[];const tagNames=new Map(tags.map(tag=>[tag.id,tag.name]));
    for(const node of parsed.nodes.filter(node=>node.kind==='tag')){const ids=Array.isArray(node.config.tagIds)?node.config.tagIds.filter((item):item is string=>typeof item==='string'):[];const names=[...(Array.isArray(node.config.tags)?node.config.tags.filter((item):item is string=>typeof item==='string'):[]),...ids.map(id=>tagNames.get(id)).filter((item):item is string=>Boolean(item))];node.config={...node.config,tagIds:[],tags:[...new Set(names)]}}
    for(const node of parsed.nodes.filter(node=>node.kind==='condition'))for(const rule of Array.isArray(node.config.rules)?node.config.rules:[])if(rule&&typeof rule==='object'&&(rule as {field?:unknown}).field==='contact.tagIds'&&Array.isArray((rule as {value?:unknown}).value)){const record=rule as {value:string[]};record.value=record.value.map(id=>tagNames.get(id)).filter((item):item is string=>Boolean(item))}
    const kanbanNodes=parsed.nodes.filter(node=>node.kind==='kanban');const boardIds=kanbanNodes.map(node=>node.config.boardId).filter((item):item is string=>typeof item==='string');
    const boards=boardIds.length?await app.prisma.kanbanBoard.findMany({where:{workspaceId:request.auth.workspaceId,id:{in:boardIds}},include:{columns:true}}):[];const boardsById=new Map(boards.map(board=>[board.id,board]));
    for(const node of kanbanNodes){const board=typeof node.config.boardId==='string'?boardsById.get(node.config.boardId):undefined;const column=board?.columns.find(item=>item.id===node.config.columnId);if(board&&column)node.config={boardName:board.name,columnName:column.name,mode:node.config.mode??'create_or_move'}}
    const pixelNodes=parsed.nodes.filter(node=>node.kind==='pixel');const pixelIds=pixelNodes.map(node=>node.config.pixelId).filter((item):item is string=>typeof item==='string');
    const pixels=pixelIds.length?await app.prisma.metaPixel.findMany({where:{workspaceId:request.auth.workspaceId,id:{in:pixelIds}},select:{id:true,name:true}}):[];const pixelNames=new Map(pixels.map(pixel=>[pixel.id,pixel.name]));
    for(const node of pixelNodes){const {pixelId,...rest}=node.config;const name=typeof pixelId==='string'?pixelNames.get(pixelId):undefined;node.config=name?{...rest,pixelName:name}:rest}
    const jumpNodes=parsed.nodes.filter(node=>node.kind==='flow_jump');const targetIds=jumpNodes.map(node=>node.config.targetPlaybookId).filter((item):item is string=>typeof item==='string');
    const targets=targetIds.length?await app.prisma.playbook.findMany({where:{workspaceId:request.auth.workspaceId,id:{in:targetIds}},select:{id:true,name:true,importSource:true}}):[];const targetsById=new Map(targets.map(target=>[target.id,target]));
    for(const node of jumpNodes){const target=typeof node.config.targetPlaybookId==='string'?targetsById.get(node.config.targetPlaybookId):undefined;const source=importSourceOf(target?.importSource);node.config={...(target?{targetName:target.name}:{}),...(source.system==='leona'&&source.flowId!==undefined?{leonaFlowId:source.flowId}: {})}}
    const redacted=redactDefinitionSecrets(parsed);const shareCode=await uniqueCode(app.prisma,'share',10);const expiresAt=new Date(Date.now()+NEXO_SHARE_CODE_TTL_DAYS*86_400_000);
    const created=await app.prisma.flowShareCode.create({data:{code:shareCode,workspaceId:request.auth.workspaceId,playbookId:id,createdById:request.auth.userId,definition:json(redacted.definition),sourceName:playbook.name,report:json(redacted.report),expiresAt}});
    await audit(app.prisma,{workspaceId:request.auth.workspaceId,actorId:request.auth.userId,action:'playbook.share_code_created',targetType:'Playbook',targetId:id,changes:{shareCodeId:created.id,expiresAt}});
    return reply.status(201).send({id:created.id,code:created.code,expiresAt:created.expiresAt,report:redacted.report});
  });

  app.get('/v1/playbooks/:id/share-codes',{preHandler:[app.requirePermission('playbook.read')]},async request=>{
    const {id}=request.params as {id:string};if(!await app.prisma.playbook.count({where:{id,workspaceId:request.auth.workspaceId}}))throw new DomainError('NOT_FOUND','Fluxo não encontrado.',404);
    return app.prisma.flowShareCode.findMany({where:{playbookId:id,workspaceId:request.auth.workspaceId},select:{id:true,code:true,expiresAt:true,revokedAt:true,createdAt:true},orderBy:{createdAt:'desc'}});
  });

  app.delete('/v1/playbooks/:id/share-codes/:shareId',{preHandler:[app.requirePermission('playbook.write')]},async(request,reply)=>{
    const {id,shareId}=request.params as {id:string;shareId:string};const changed=await app.prisma.flowShareCode.updateMany({where:{id:shareId,playbookId:id,workspaceId:request.auth.workspaceId,revokedAt:null},data:{revokedAt:new Date()}});
    if(!changed.count)throw new DomainError('SHARE_CODE_NOT_FOUND','Código não encontrado ou já revogado.',404);return reply.status(204).send();
  });

  app.post('/v1/imports/nexo',{preHandler:[app.requirePermission('playbook.write')]},async(request,reply)=>{
    const input=ImportNexoShareInput.parse(request.body);const share=await app.prisma.flowShareCode.findUnique({where:{code:input.code}});
    if(!share||share.revokedAt||share.expiresAt<=new Date())throw new DomainError('SHARE_CODE_INVALID','Código inexistente, expirado ou revogado.',410);
    const definition=AutomationDefinitionSchema.parse(share.definition);const sourceReport=structuredClone(share.report) as ImportReport;
    const playbook=await app.prisma.$transaction(async tx=>{await resolveTags(tx,request.auth.workspaceId,definition,sourceReport);await resolveKanban(tx,request.auth.workspaceId,definition,sourceReport);await resolvePixels(tx,request.auth.workspaceId,definition,sourceReport);await resolveFlowJumps(tx,request.auth.workspaceId,definition,sourceReport);reportCompilerIssues(definition,sourceReport);const created=await createImportedPlaybook(tx,{workspaceId:request.auth.workspaceId,userId:request.auth.userId,name:`${share.sourceName} (cópia)`,definition});await audit(tx,{workspaceId:request.auth.workspaceId,actorId:request.auth.userId,action:'playbook.imported_from_nexo',targetType:'Playbook',targetId:created.id,changes:{sourceShareId:share.id}});return created});
    return reply.status(201).send({playbookId:playbook.id,report:sourceReport});
  });
};
