import {PrismaClient} from '@prisma/client';import argon2 from 'argon2';import {createHash} from 'node:crypto';
const prisma=new PrismaClient();
async function main(){
  const passwordHash=await argon2.hash('NexoDemo2026!');
  const user=await prisma.user.upsert({where:{email:'admin@nexo.local'},update:{},create:{email:'admin@nexo.local',name:'Thiago',passwordHash}});
  const workspace=await prisma.workspace.upsert({where:{slug:'clinica-aurora'},update:{},create:{name:'Clínica Aurora',slug:'clinica-aurora'}});
  await prisma.membership.upsert({where:{workspaceId_userId:{workspaceId:workspace.id,userId:user.id}},update:{role:'OWNER'},create:{workspaceId:workspace.id,userId:user.id,role:'OWNER'}});
  const channel=await prisma.channel.upsert({where:{externalPhoneId:'demo-phone-id'},update:{},create:{workspaceId:workspace.id,displayName:'Clínica Aurora — Principal',phoneNumber:'+55 71 3021-4480',externalPhoneId:'demo-phone-id',status:'CONNECTED'}});
  const contacts:[string,string,string][]=[['Marina Costa','+5571999124830','instagram'],['Rafael Lima','+5571988421029','referral'],['Beatriz Alves','+5571991526207','website']];
  for(const [name,phone,source] of contacts){
    const contact=await prisma.contact.upsert({where:{workspaceId_phone:{workspaceId:workspace.id,phone}},update:{},create:{workspaceId:workspace.id,name,phone,source,stage:'qualification'}});
    const conversation=await prisma.conversation.findFirst({where:{workspaceId:workspace.id,contactId:contact.id}})??await prisma.conversation.create({data:{workspaceId:workspace.id,channelId:channel.id,contactId:contact.id,status:name==='Marina Costa'?'AUTOMATED':'QUEUED',mode:name==='Marina Costa'?'AI':'PAUSED',unreadCount:1}});
    if(await prisma.message.count({where:{conversationId:conversation.id}})===0)await prisma.message.createMany({data:[{workspaceId:workspace.id,conversationId:conversation.id,externalId:`seed-${contact.id}-1`,direction:'INBOUND',type:'TEXT',status:'DELIVERED',body:name==='Marina Costa'?'Oi! Queria saber mais sobre harmonização facial.':'Queria falar com uma pessoa, por favor.',authorType:'contact',authorId:contact.id},{workspaceId:workspace.id,conversationId:conversation.id,externalId:`seed-${contact.id}-2`,direction:'OUTBOUND',type:'TEXT',status:'DELIVERED',body:'Olá! Posso ajudar e transferir para nossa equipe sempre que necessário.',authorType:'ai'}]});
  }
  const definition={start:'trigger',nodes:[{id:'trigger',kind:'trigger',name:'Nova mensagem',config:{event:'message.received'},position:{x:80,y:160}},{id:'welcome',kind:'message',name:'Boas-vindas',config:{text:'Olá! Como posso ajudar?'},position:{x:320,y:160}},{id:'outcome',kind:'outcome',name:'Lead qualificado',config:{type:'QUALIFIED'},position:{x:560,y:160}}],edges:[{id:'e1',source:'trigger',target:'welcome',isDefault:false,priority:0},{id:'e2',source:'welcome',target:'outcome',isDefault:false,priority:0}],settings:{maxSteps:30,timeoutSeconds:300}};
  let playbook=await prisma.playbook.findFirst({where:{workspaceId:workspace.id,name:'Qualificação e agendamento'},include:{versions:{orderBy:{version:'desc'},take:1}}});
  if(!playbook){playbook=await prisma.playbook.create({data:{workspaceId:workspace.id,name:'Qualificação e agendamento',description:'Qualifica e encontra horários.',status:'PUBLISHED',versions:{create:{version:1,definition,checksum:createHash('sha256').update(JSON.stringify(definition)).digest('hex'),createdById:user.id,publishedAt:new Date()}}},include:{versions:{orderBy:{version:'desc'},take:1}}})}
  const currentDefinition=playbook.versions[0]?.definition as {settings?:unknown}|undefined;
  if(!currentDefinition?.settings){const next=await prisma.playbookVersion.create({data:{playbookId:playbook.id,version:(playbook.versions[0]?.version??0)+1,definition,checksum:createHash('sha256').update(JSON.stringify(definition)).digest('hex'),createdById:user.id,publishedAt:new Date()}});await prisma.playbook.update({where:{id:playbook.id},data:{activeVersionId:next.id,status:'PUBLISHED'}})}else if(!playbook.activeVersionId){await prisma.playbook.update({where:{id:playbook.id},data:{activeVersionId:playbook.versions[0]!.id,status:'PUBLISHED'}})}
  await prisma.channel.update({where:{id:channel.id},data:{activePlaybookId:playbook.id}});
  await prisma.subscription.upsert({where:{externalId:'demo-subscription'},update:{},create:{workspaceId:workspace.id,provider:'local',externalId:'demo-subscription',plan:'growth',status:'active',limits:{conversations:2000,users:10,channels:2},currentPeriodStart:new Date(new Date().getFullYear(),new Date().getMonth(),1),currentPeriodEnd:new Date(new Date().getFullYear(),new Date().getMonth()+1,1)}});
  console.log('Seed concluído. Login: admin@nexo.local / NexoDemo2026!');
}
main().finally(()=>prisma.$disconnect());
