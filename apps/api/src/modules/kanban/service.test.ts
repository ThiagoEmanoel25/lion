import {describe,expect,it} from 'vitest';
import {kanbanAction} from '@nexo/domain';
import {relocateAndDeleteColumn} from './service.js';

describe('regras do bloco Kanban',()=>{
  it('cria ou move no modo padrão',()=>{
    expect(kanbanAction('create_or_move',null,'column-b')).toBe('create');
    expect(kanbanAction('create_or_move','column-a','column-b')).toBe('move');
  });
  it('não move card existente no create_only',()=>expect(kanbanAction('create_only','column-a','column-b')).toBe('noop'));
  it('não cria card ausente no move_only',()=>expect(kanbanAction('move_only',null,'column-b')).toBe('noop'));
  it('mantém um card que já está na coluna',()=>expect(kanbanAction('create_or_move','column-b','column-b')).toBe('noop'));
  it('exige realocação ao excluir coluna com cards',async()=>{
    const tx={kanbanColumn:{findFirst:async()=>({id:'column-a',boardId:'board',_count:{cards:2}})}};
    const prisma={$transaction:(run:(client:unknown)=>unknown)=>run(tx)};
    await expect(relocateAndDeleteColumn(prisma,{workspaceId:'workspace',columnId:'column-a',actor:{type:'user',id:'user'}})).rejects.toMatchObject({code:'KANBAN_DESTINATION_REQUIRED'});
  });
  it('realoca todos os cards antes de excluir a coluna',async()=>{
    const updates:unknown[]=[];const events:unknown[]=[];let reads=0;
    const tx={
      kanbanColumn:{findFirst:async()=>++reads===1?{id:'column-a',boardId:'board',_count:{cards:2}}:{id:'column-b'},delete:async()=>({})},
      kanbanCard:{count:async()=>1,findMany:async()=>[{id:'card-1'},{id:'card-2'}],update:async(input:unknown)=>{updates.push(input);return {}}},
      kanbanCardEvent:{create:async(input:unknown)=>{events.push(input);return {}}}
    };
    const prisma={$transaction:(run:(client:unknown)=>unknown)=>run(tx)};
    await expect(relocateAndDeleteColumn(prisma,{workspaceId:'workspace',columnId:'column-a',destinationColumnId:'column-b',actor:{type:'user',id:'user'}})).resolves.toMatchObject({deleted:true,relocated:2,destinationColumnId:'column-b'});
    expect(updates).toHaveLength(2);expect(events).toHaveLength(2);
  });
});
