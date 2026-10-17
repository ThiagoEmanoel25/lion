import {AutomationPixelConfigSchema} from '@nexo/contracts';
import type {AutomationDefinition,AutomationIssue} from '../playbooks/compiler.js';

export async function pixelReferenceIssues(prisma:any,workspaceId:string,definition:AutomationDefinition):Promise<AutomationIssue[]>{
  const nodes=definition.nodes.filter(node=>node.kind==='pixel');
  if(!nodes.length)return [];
  const parsed=nodes.map(node=>({node,result:AutomationPixelConfigSchema.safeParse(node.config)})).filter(item=>item.result.success) as Array<{node:(typeof nodes)[number];result:{success:true;data:{pixelId:string}}}>;
  if(!parsed.length)return [];
  const found=await prisma.metaPixel.findMany({where:{workspaceId,id:{in:[...new Set(parsed.map(item=>item.result.data.pixelId))]}},select:{id:true}});
  const ids=new Set<string>(found.map((pixel:any)=>String(pixel.id)));
  return parsed.filter(({result})=>!ids.has(result.data.pixelId)).map(({node})=>({level:'error' as const,code:'PIXEL_NOT_FOUND',message:'O pixel selecionado não existe ou foi excluído.',nodeId:node.id}));
}
