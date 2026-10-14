import type {FastifyPluginAsync} from 'fastify';
import type {Prisma} from '@prisma/client';
import {CreateContactInput,CreateContactTagInput,ImportContactsInput,UpdateContactInput} from '@nexo/contracts';
import {DomainError} from '@nexo/domain';
import {audit} from '../../core/audit.js';
import {normalizePhone,parseContactsCsv} from './csv.js';
import {assertWorkspaceQuota} from '../billing/service.js';
import {enqueue} from '../../core/outbox.js';

const contactInclude={owner:{select:{id:true,name:true,email:true}},tags:{include:{tag:true},orderBy:{tag:{name:'asc' as const}}}};

async function validateReferences(prisma:any,workspaceId:string,ownerId:string|null|undefined,tagIds:string[]|undefined){
  if(ownerId){const member=await prisma.membership.findFirst({where:{workspaceId,userId:ownerId}});if(!member)throw new DomainError('INVALID_OWNER','O responsável não pertence a este workspace.',422)}
  if(tagIds?.length){const unique=new Set(tagIds);const count=await prisma.tag.count({where:{workspaceId,id:{in:[...unique]}}});if(count!==unique.size)throw new DomainError('INVALID_TAG','Uma ou mais etiquetas não pertencem a este workspace.',422)}
}

async function enqueueAddedTags(tx:any,workspaceId:string,contactId:string,tagIds:string[]){
  for(const tagId of tagIds)await enqueue(tx,{workspaceId,aggregate:'Contact',aggregateId:contactId,type:'automation.trigger.requested',payload:{event:'tag.added',contactId,tagId}});
}

export const contactRoutes:FastifyPluginAsync=async app=>{
  app.get('/v1/contacts',{preHandler:[app.requirePermission('contact.read')]},async request=>{
    const q=request.query as {search?:string;stage?:string;ownerId?:string;tagId?:string;cursor?:string};
    const items=await app.prisma.contact.findMany({where:{workspaceId:request.auth.workspaceId,stage:q.stage||undefined,ownerId:q.ownerId||undefined,tags:q.tagId?{some:{tagId:q.tagId}}:undefined,OR:q.search?[{name:{contains:q.search,mode:'insensitive'}},{phone:{contains:q.search}},{email:{contains:q.search,mode:'insensitive'}}]:undefined},take:51,...(q.cursor?{cursor:{id:q.cursor},skip:1}:{}),orderBy:{updatedAt:'desc'},include:contactInclude});
    return {items:items.slice(0,50),nextCursor:items.length>50?items[49]!.id:null};
  });

  app.get('/v1/contacts/meta',{preHandler:[app.requirePermission('contact.read')]},async request=>{
    const workspaceId=request.auth.workspaceId;
    const [groups,tags,members]=await Promise.all([
      app.prisma.contact.groupBy({by:['stage'],where:{workspaceId},_count:{_all:true},orderBy:{stage:'asc'}}),
      app.prisma.tag.findMany({where:{workspaceId},orderBy:{name:'asc'}}),
      app.prisma.membership.findMany({where:{workspaceId,user:{isActive:true}},select:{role:true,user:{select:{id:true,name:true,email:true}}},orderBy:{user:{name:'asc'}}})
    ]);
    return {stageCounts:groups.map(group=>({stage:group.stage,count:group._count._all})),tags,members:members.map(member=>({...member.user,role:member.role}))};
  });

  app.post('/v1/contact-tags',{preHandler:[app.requirePermission('contact.update')]},async(request,reply)=>{
    const input=CreateContactTagInput.parse(request.body);try{const tag=await app.prisma.tag.create({data:{...input,workspaceId:request.auth.workspaceId}});await audit(app.prisma,{workspaceId:request.auth.workspaceId,actorId:request.auth.userId,action:'contact_tag.created',targetType:'Tag',targetId:tag.id,ip:request.ip});return reply.status(201).send(tag)}catch(error:any){if(error?.code==='P2002')throw new DomainError('TAG_EXISTS','Já existe uma etiqueta com este nome.',409);throw error}
  });

  app.get('/v1/contacts/:id',{preHandler:[app.requirePermission('contact.read')]},async request=>{
    const {id}=request.params as {id:string};const contact=await app.prisma.contact.findFirst({where:{id,workspaceId:request.auth.workspaceId},include:contactInclude});
    if(!contact)throw new DomainError('NOT_FOUND','Contato não encontrado.',404);return contact;
  });

  app.post('/v1/contacts',{preHandler:[app.requirePermission('contact.update')]},async(request,reply)=>{
    const input=CreateContactInput.parse(request.body);await assertWorkspaceQuota(app.prisma,request.auth.workspaceId,'contacts');await validateReferences(app.prisma,request.auth.workspaceId,input.ownerId,input.tagIds);const {tagIds,customFields,...fields}=input;
    try{const contact=await app.prisma.$transaction(async tx=>{const created=await tx.contact.create({data:{...fields,phone:normalizePhone(fields.phone),customFields:customFields as Prisma.InputJsonValue,workspaceId:request.auth.workspaceId,tags:{create:tagIds.map(tagId=>({tagId}))}},include:contactInclude});await enqueueAddedTags(tx,request.auth.workspaceId,created.id,tagIds);await audit(tx,{workspaceId:request.auth.workspaceId,actorId:request.auth.userId,action:'contact.created',targetType:'Contact',targetId:created.id,ip:request.ip});return created});return reply.status(201).send(contact)}catch(error:any){if(error?.code==='P2002')throw new DomainError('CONTACT_EXISTS','Já existe um contato com este telefone.',409);throw error}
  });

  app.patch('/v1/contacts/:id',{preHandler:[app.requirePermission('contact.update')]},async request=>{
    const {id}=request.params as {id:string};const input=UpdateContactInput.parse(request.body);const current=await app.prisma.contact.findFirst({where:{id,workspaceId:request.auth.workspaceId},include:{tags:{select:{tagId:true}}}});if(!current)throw new DomainError('NOT_FOUND','Contato não encontrado.',404);
    await validateReferences(app.prisma,request.auth.workspaceId,input.ownerId,input.tagIds);const {tagIds,customFields,...fields}=input;
    try{return await app.prisma.$transaction(async tx=>{const contact=await tx.contact.update({where:{id},data:{...fields,email:fields.email||null,phone:fields.phone?normalizePhone(fields.phone):undefined,customFields:customFields as Prisma.InputJsonValue|undefined,tags:tagIds?{deleteMany:{},create:tagIds.map(tagId=>({tagId}))}:undefined},include:contactInclude});if(tagIds){const previous=new Set(current.tags.map(item=>item.tagId));await enqueueAddedTags(tx,request.auth.workspaceId,id,tagIds.filter(tagId=>!previous.has(tagId)))}await audit(tx,{workspaceId:request.auth.workspaceId,actorId:request.auth.userId,action:'contact.updated',targetType:'Contact',targetId:id,changes:JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue,ip:request.ip});return contact})}catch(error:any){if(error?.code==='P2002')throw new DomainError('CONTACT_EXISTS','Já existe um contato com este telefone.',409);throw error}
  });

  app.post('/v1/contacts/import',{preHandler:[app.requirePermission('contact.update')]},async(request,reply)=>{
    const input=ImportContactsInput.parse(request.body);const parsed=parseContactsCsv(input.csv);if(parsed.rows.length+parsed.errors.length>2000)throw new DomainError('IMPORT_TOO_LARGE','Cada importação aceita no máximo 2.000 contatos.',422);
    const report={total:parsed.rows.length+parsed.errors.length,created:0,updated:0,failed:parsed.errors.length,errors:[...parsed.errors]};const workspaceId=request.auth.workspaceId;const quota=await assertWorkspaceQuota(app.prisma,workspaceId,'contacts');
    for(const row of parsed.rows){try{const existing=await app.prisma.contact.findUnique({where:{workspaceId_phone:{workspaceId,phone:row.phone}}});if(existing&&!input.updateExisting){report.failed+=1;report.errors.push({row:row.row,message:'Telefone já cadastrado.'});continue}if(!existing&&quota.limit!==null&&quota.used+report.created>=quota.limit){report.failed+=1;report.errors.push({row:row.row,message:'Limite de contatos do plano atingido.'});continue}
      await app.prisma.$transaction(async tx=>{const tagIds:string[]=[];for(const name of row.tags){const tag=await tx.tag.upsert({where:{workspaceId_name:{workspaceId,name}},create:{workspaceId,name},update:{}});tagIds.push(tag.id)}const data={name:row.name,email:row.email,source:row.source,stage:row.stage,customFields:row.customFields as Prisma.InputJsonValue,tags:{deleteMany:{},create:tagIds.map(tagId=>({tagId}))}};if(existing)await tx.contact.update({where:{id:existing.id},data});else await tx.contact.create({data:{workspaceId,phone:row.phone,...data}})});if(existing)report.updated+=1;else report.created+=1
    }catch(error){report.failed+=1;report.errors.push({row:row.row,message:error instanceof Error?error.message:'Falha ao importar.'})}}
    await audit(app.prisma,{workspaceId,actorId:request.auth.userId,action:'contacts.imported',targetType:'ContactImport',targetId:request.id,changes:{total:report.total,created:report.created,updated:report.updated,failed:report.failed},ip:request.ip});return reply.status(report.created||report.updated?200:422).send(report);
  });
};
