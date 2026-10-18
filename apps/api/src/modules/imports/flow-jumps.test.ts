import {readFileSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import type {Prisma} from '@prisma/client';
import {convertLeonaFlow} from './converter.js';
import {bookmarklet,leonaImportSource,parseLeonaImportRequest,reportCompilerIssues,resolveFlowJumps} from './routes.js';

const jumpFlow=(targets:Array<{id:string|number;name:string}>)=>convertLeonaFlow({label:'Origem',nodes:[
  {id:'start',type:'start',position:{x:0,y:0}},
  ...targets.map((target,index)=>({id:`jump-${index}`,type:'connection_flow',position:{x:200+index*200,y:0},data:{actions:[{action_type:'execute_flow',order:1,config:{target_flow_id:target.id,target_flow_name:target.name}}]}}))
],edges:targets.length?[{source:'start',target:'jump-0'}]:[]});
const load=(name:string)=>JSON.parse(readFileSync(new URL(`./fixtures/${name}`,import.meta.url),'utf8'));

describe('resolução de saltos na importação Leona',()=>{
  it('prioriza importSource.flowId e usa nome sem diferenciar maiúsculas como fallback',async()=>{
    const converted=jumpFlow([{id:140148,name:'Nome antigo'},{id:999,name:'gelatina-funil-04'}]);
    const tx={playbook:{findMany:vi.fn().mockResolvedValue([
      {id:'flow-by-source',name:'GELATINA-FUNIL-03',importSource:{system:'leona',flowId:'140148'}},
      {id:'flow-by-name',name:'GELATINA-FUNIL-04',importSource:null}
    ])}} as unknown as Prisma.TransactionClient;
    await resolveFlowJumps(tx,'workspace',converted.definition,converted.report);
    expect(converted.definition.nodes.filter(node=>node.kind==='flow_jump').map(node=>node.config)).toEqual([{targetPlaybookId:'flow-by-source'},{targetPlaybookId:'flow-by-name'}]);
    expect(converted.report.items.filter(item=>item.sourceType==='connection_flow'&&item.status==='pending')).toHaveLength(0);
    expect(converted.report.items.filter(item=>item.sourceType==='connection_flow'&&item.status==='adjusted')).toHaveLength(2);
    expect(tx.playbook.findMany).toHaveBeenCalledWith({where:{workspaceId:'workspace'},select:{id:true,name:true,importSource:true}});
  });

  it('mantém metadados da Leona e uma única pendência quando o destino ainda não foi importado',async()=>{
    const converted=jumpFlow([{id:140360,name:'GELATINA-FUNIL-05'}]);const tx={playbook:{findMany:vi.fn().mockResolvedValue([])}} as unknown as Prisma.TransactionClient;
    await resolveFlowJumps(tx,'workspace',converted.definition,converted.report);reportCompilerIssues(converted.definition,converted.report);
    expect(converted.definition.nodes.find(node=>node.kind==='flow_jump')?.config).toEqual({leonaFlowId:140360,targetName:'GELATINA-FUNIL-05'});
    expect(converted.report.items.filter(item=>item.status==='pending'&&item.sourceType==='connection_flow')).toEqual([expect.objectContaining({sourceId:'leona_jump-0',message:expect.stringContaining('Importe “GELATINA-FUNIL-05” primeiro')})]);
    expect(converted.report.items.some(item=>item.sourceType==='compiler'&&item.message.includes('destino'))).toBe(false);
  });

  it('captura sourceFlowId no payload e forma metadado de origem sem segredos',()=>{
    const input=parseLeonaImportRequest({source:'leona',version:1,sourceFlowId:'140360',nodes:[{id:'1'}],edges:[],label:'Fluxo'});
    expect(input.sourceFlowId).toBe('140360');expect(leonaImportSource(input.sourceFlowId)).toEqual({system:'leona',flowId:'140360'});
    expect(()=>parseLeonaImportRequest({...input,api_key:'segredo'})).toThrow();
    const script=decodeURIComponent(bookmarklet('https://api.nexo.test').replace(/^javascript:/,''));
    expect(script).toContain("location.pathname.match(/\\/flows\\/(\\d+)/)");
    expect(script).toContain('sourceFlowId');expect(script).not.toContain('api_key');
  });

  it('resolve os saltos das cinco fixtures quando importadas de 05 para 01',async()=>{
    const imported:Array<{id:string;name:string;importSource:unknown}>=[];const tx={playbook:{findMany:vi.fn(async()=>imported)}} as unknown as Prisma.TransactionClient;
    for(const number of [5,4,3,2,1]){const raw=load(`leona-funil-0${number}.redacted.json`);const converted=convertLeonaFlow(raw);await resolveFlowJumps(tx,'workspace',converted.definition,converted.report);const jumps=converted.definition.nodes.filter(node=>node.kind==='flow_jump');expect(jumps.every(node=>typeof node.config.targetPlaybookId==='string')).toBe(true);expect(converted.report.items.some(item=>item.sourceType==='connection_flow'&&item.status==='pending')).toBe(false);imported.push({id:`playbook-${number}`,name:raw.label,importSource:leonaImportSource(raw.sourceFlowId)})}
  });
});
