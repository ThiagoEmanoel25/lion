import type {FastifyPluginAsync} from 'fastify';
import {DomainError} from '@nexo/domain';

const MAX_ASSET_BYTES=10*1024*1024;
const ASSET_ID=/^[a-z0-9]{20,32}$/i;

function header(value:string|string[]|undefined){return Array.isArray(value)?value[0]:value}
function fileNameOf(value:string|string[]|undefined){
  const encoded=header(value);
  if(!encoded)throw new DomainError('ASSET_FILE_NAME_REQUIRED','Informe o nome do arquivo.',422);
  let decoded:string;try{decoded=decodeURIComponent(encoded)}catch{throw new DomainError('ASSET_FILE_NAME_INVALID','O nome do arquivo é inválido.',422)}
  const name=decoded.replace(/[\\/\0]/g,'').trim();
  if(!name||name.length>255)throw new DomainError('ASSET_FILE_NAME_INVALID','Use um nome de arquivo com até 255 caracteres.',422);
  return name;
}
function contentTypeOf(value:string|string[]|undefined){
  const contentType=(header(value)??'application/octet-stream').split(';',1)[0]!.trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(contentType)||contentType.length>120)throw new DomainError('ASSET_CONTENT_TYPE_INVALID','O tipo do arquivo é inválido.',422);
  return contentType;
}

export const assetRoutes:FastifyPluginAsync=async app=>{
  app.addContentTypeParser('application/octet-stream',{parseAs:'buffer',bodyLimit:MAX_ASSET_BYTES},(_request,body,done)=>done(null,body));
  const guard={preHandler:[app.requirePermission('playbook.write')]};

  app.post('/v1/playbook-assets',guard,async(request,reply)=>{
    const data=request.body;
    if(!Buffer.isBuffer(data)||data.length===0)throw new DomainError('ASSET_EMPTY','Selecione um arquivo para enviar.',422);
    if(data.length>MAX_ASSET_BYTES)throw new DomainError('ASSET_TOO_LARGE','O arquivo deve ter no máximo 10 MB.',413);
    const fileName=fileNameOf(request.headers['x-file-name']);
    const contentType=contentTypeOf(request.headers['x-file-content-type']);
    const asset=await app.prisma.playbookAsset.create({data:{workspaceId:request.auth.workspaceId,fileName,contentType,size:data.length,data:Uint8Array.from(data)}});
    return reply.status(201).send({id:asset.id,fileName:asset.fileName,contentType:asset.contentType,size:asset.size,url:`nexo-asset://${asset.id}`});
  });

  app.delete('/v1/playbook-assets/:id',guard,async(request,reply)=>{
    const {id}=request.params as {id:string};
    if(!ASSET_ID.test(id))throw new DomainError('NOT_FOUND','Arquivo não encontrado.',404);
    const deleted=await app.prisma.playbookAsset.deleteMany({where:{id,workspaceId:request.auth.workspaceId}});
    if(!deleted.count)throw new DomainError('NOT_FOUND','Arquivo não encontrado.',404);
    return reply.status(204).send();
  });
};
