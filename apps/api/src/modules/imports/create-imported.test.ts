import {describe,expect,it,vi} from 'vitest';
import type {Prisma} from '@prisma/client';
import {createImportedPlaybook,leonaImportSource} from './routes.js';

const report={source:'leona' as const,items:[{status:'pending' as const,message:'Header Authorization ausente'}],totals:{converted:0,adjusted:0,pending:1}};
const run=async(importSource?:Prisma.InputJsonValue)=>{const create=vi.fn(async(args:unknown)=>args);await createImportedPlaybook({playbook:{create}} as unknown as Prisma.TransactionClient,{workspaceId:'w',userId:'u',name:'n',definition:{nodes:[],edges:[]} as never,report,...(importSource?{importSource}:{})});return (create.mock.calls[0]![0] as {data:{importSource:unknown}}).data.importSource};

describe('createImportedPlaybook',()=>{
  it('guarda o relatório mantendo system e flowId',async()=>{expect(await run(leonaImportSource(140148))).toEqual({system:'leona',flowId:140148,report})});
  it('usa system nexo quando não há origem',async()=>{expect(await run()).toEqual({system:'nexo',report})});
});
