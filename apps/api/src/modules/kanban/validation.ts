import {AutomationKanbanConfigSchema} from '@nexo/contracts';
import type {AutomationDefinition,AutomationIssue} from '../playbooks/compiler.js';

export async function kanbanReferenceIssues(prisma:any,workspaceId:string,definition:AutomationDefinition):Promise<AutomationIssue[]>{
  const nodes=definition.nodes.filter(node=>node.kind==='kanban');
  if(!nodes.length)return [];
  const parsed=nodes.map(node=>({node,result:AutomationKanbanConfigSchema.safeParse(node.config)})).filter(item=>item.result.success) as Array<{node:(typeof nodes)[number];result:{success:true;data:{boardId:string;columnId:string}}}>;
  const boards=await prisma.kanbanBoard.findMany({where:{workspaceId,id:{in:[...new Set(parsed.map(item=>item.result.data.boardId))]}},select:{id:true,columns:{select:{id:true}}}});
  const byId=new Map<string,Set<string>>(boards.map((board:any)=>[String(board.id),new Set<string>(board.columns.map((column:any)=>String(column.id)))]));
  const issues:AutomationIssue[]=[];
  for(const {node,result} of parsed){const columns=byId.get(result.data.boardId);if(!columns)issues.push({level:'error',code:'KANBAN_BOARD_NOT_FOUND',message:'O quadro selecionado não existe ou foi excluído.',nodeId:node.id});else if(!columns.has(result.data.columnId))issues.push({level:'error',code:'KANBAN_COLUMN_NOT_FOUND',message:'A coluna selecionada não existe neste quadro ou foi excluída.',nodeId:node.id})}
  return issues;
}
