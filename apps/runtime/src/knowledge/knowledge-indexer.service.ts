import {Injectable} from '@nestjs/common';import {PrismaService} from '../infra/prisma.service.js';
export function chunkText(content:string,maxLength=1200){const paragraphs=content.replace(/\r/g,'').split(/\n{2,}/).map(value=>value.trim()).filter(Boolean);const chunks:string[]=[];let current='';for(const paragraph of paragraphs){const parts=paragraph.length>maxLength?paragraph.match(new RegExp(`[\\s\\S]{1,${maxLength}}`,'g'))??[]:[paragraph];for(const part of parts){if(current&&current.length+part.length+2>maxLength){chunks.push(current);current=''}current=current?`${current}\n\n${part}`:part}}if(current)chunks.push(current);return chunks}
const TEXT_FILE_EXTENSIONS=['txt','md','csv','json'];
/** Motivo pelo qual a fonte não pode ser indexada, ou null. Espelha a validação da API (modules/knowledge/routes.ts). */
export function unindexableReason(source:{kind:string;name:string},content:string|null){
  if(source.kind==='url')return 'Importação automática de URL ainda não está habilitada; use uma fonte de texto.';
  if(source.kind!=='text'&&source.kind!=='file')return 'Tipo de fonte não suportado.';
  if(!content?.trim())return 'A fonte não possui conteúdo para indexação.';
  if(source.kind==='file'){
    const extension=/\.([a-z0-9]+)$/i.exec(source.name.trim())?.[1]?.toLowerCase()??'';
    if(!TEXT_FILE_EXTENSIONS.includes(extension))return `Só arquivos de texto (${TEXT_FILE_EXTENSIONS.join(', ')}) são suportados; PDF e Office ainda não.`;
    if(content.includes('\u0000')||content.includes('\uFFFD'))return 'O arquivo não parece ser texto UTF-8 válido.';
  }
  return null;
}
@Injectable() export class KnowledgeIndexerService{constructor(private readonly prisma:PrismaService){}async index(sourceId:string,content:string|null){const source=await this.prisma.knowledgeSource.findUnique({where:{id:sourceId}});if(!source)return;const reason=unindexableReason(source,content);if(reason){await this.prisma.knowledgeSource.update({where:{id:sourceId},data:{status:'FAILED',error:reason}});return}await this.prisma.knowledgeSource.update({where:{id:sourceId},data:{status:'INDEXING',error:null}});const chunks=chunkText(content as string);if(!chunks.length){await this.prisma.knowledgeSource.update({where:{id:sourceId},data:{status:'FAILED',error:'Nenhum conteúdo útil foi encontrado.'}});return}await this.prisma.$transaction(async tx=>{await tx.knowledgeChunk.deleteMany({where:{sourceId}});await tx.knowledgeChunk.createMany({data:chunks.map((value,ordinal)=>({workspaceId:source.workspaceId,sourceId,ordinal,content:value,metadata:{characters:value.length}}))});await tx.knowledgeSource.update({where:{id:sourceId},data:{status:'READY',contentHash:null,error:null}})})}}
