import type {FastifyPluginAsync} from 'fastify';import {z} from 'zod';import {DomainError} from '@nexo/domain';import {enqueue} from '../../core/outbox.js';
const sourceInput=z.object({name:z.string().min(2).max(160),kind:z.enum(['text','url','file']),uri:z.string().max(2048).optional(),content:z.string().max(100000).optional()}).refine(v=>v.uri||v.content,{message:'Informe uri ou conteúdo.'});
// Mesmas regras do indexador do runtime (apps/runtime/src/knowledge/knowledge-indexer.service.ts): nada é aceito aqui para falhar lá.
const TEXT_FILE_EXTENSIONS=['txt','md','csv','json'];
const fileExtension=(name:string)=>/\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase()??'';
function assertIndexable(input:z.infer<typeof sourceInput>){
  if(input.kind==='url')throw new DomainError('KNOWLEDGE_KIND_UNSUPPORTED','A importação de páginas por URL ainda não está disponível. Cole o conteúdo como texto ou envie um arquivo de texto (txt, md, csv ou json).',422);
  if(!input.content?.trim())throw new DomainError('KNOWLEDGE_KIND_UNSUPPORTED',input.kind==='file'?'Envie o conteúdo do arquivo; a leitura a partir de um endereço (uri) não está disponível.':'Informe o conteúdo do texto; a leitura a partir de um endereço (uri) não está disponível.',422);
  if(input.kind==='file'){
    const extension=fileExtension(input.name);
    if(!TEXT_FILE_EXTENSIONS.includes(extension))throw new DomainError('KNOWLEDGE_FILE_UNSUPPORTED',`Só arquivos de texto (${TEXT_FILE_EXTENSIONS.join(', ')}) são aceitos${extension?`; .${extension} (PDF e Office, por exemplo) não é suportado ainda`:'; o nome do arquivo precisa terminar na extensão, como manual.txt'}.`,422);
    if(input.content.includes('\u0000')||input.content.includes('\uFFFD'))throw new DomainError('KNOWLEDGE_FILE_UNSUPPORTED','O arquivo não parece ser texto UTF-8 válido.',422);
  }
}
export const knowledgeRoutes:FastifyPluginAsync=async app=>{
  app.get('/v1/knowledge/sources',{preHandler:[app.requirePermission('knowledge.read')]},async request=>app.prisma.knowledgeSource.findMany({where:{workspaceId:request.auth.workspaceId},include:{_count:{select:{chunks:true}}},orderBy:{updatedAt:'desc'}}));
  app.post('/v1/knowledge/sources',{preHandler:[app.requirePermission('knowledge.write')]},async(request,reply)=>{const input=sourceInput.parse(request.body);assertIndexable(input);const source=await app.prisma.$transaction(async tx=>{const created=await tx.knowledgeSource.create({data:{workspaceId:request.auth.workspaceId,name:input.name,kind:input.kind,uri:input.uri,status:'PENDING'}});await enqueue(tx,{workspaceId:request.auth.workspaceId,aggregate:'KnowledgeSource',aggregateId:created.id,type:'knowledge.index.requested',payload:{sourceId:created.id,content:input.content??null}});return created});return reply.status(202).send(source)});
  app.delete('/v1/knowledge/sources/:id',{preHandler:[app.requirePermission('knowledge.write')]},async(request,reply)=>{const {id}=request.params as {id:string};const result=await app.prisma.knowledgeSource.deleteMany({where:{id,workspaceId:request.auth.workspaceId}});if(!result.count)throw new DomainError('NOT_FOUND','Fonte não encontrada.',404);return reply.status(204).send()});
};
