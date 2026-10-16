import {describe,expect,it} from 'vitest';
import {kanbanReferenceIssues} from './validation.js';
import type {AutomationDefinition} from '../playbooks/compiler.js';

const boardId='clx000000000000000000001';
const columnId='clx000000000000000000002';
const definition:AutomationDefinition={start:'start',nodes:[{id:'start',kind:'trigger',name:'Início',config:{event:'message.received'},position:{x:0,y:0}},{id:'kanban',kind:'kanban',name:'Mover',config:{boardId,columnId,mode:'create_or_move'},position:{x:100,y:0}},{id:'end',kind:'outcome',name:'Fim',config:{type:'RESOLVED'},position:{x:200,y:0}}],edges:[{id:'a',source:'start',target:'kanban',isDefault:false,priority:0},{id:'b',source:'kanban',target:'end',isDefault:false,priority:0}],settings:{maxSteps:30,timeoutSeconds:300}};

describe('validação das referências Kanban',()=>{
  it('aceita quadro e coluna existentes',async()=>{const prisma={kanbanBoard:{findMany:async()=>[{id:boardId,columns:[{id:columnId}]}]}};expect(await kanbanReferenceIssues(prisma,'workspace',definition)).toEqual([])});
  it('aponta quadro excluído',async()=>{const prisma={kanbanBoard:{findMany:async()=>[]}};expect((await kanbanReferenceIssues(prisma,'workspace',definition))[0]?.code).toBe('KANBAN_BOARD_NOT_FOUND')});
  it('aponta coluna de outro quadro ou excluída',async()=>{const prisma={kanbanBoard:{findMany:async()=>[{id:boardId,columns:[]}]}};expect((await kanbanReferenceIssues(prisma,'workspace',definition))[0]?.code).toBe('KANBAN_COLUMN_NOT_FOUND')});
});
