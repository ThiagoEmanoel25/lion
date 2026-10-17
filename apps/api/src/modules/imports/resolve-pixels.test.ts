import {describe,expect,it} from 'vitest';
import {AutomationDefinitionSchema} from '@nexo/contracts';
import {readFileSync} from 'node:fs';
import {convertLeonaFlow} from './converter.js';
import {validateAutomation,type AutomationIssue} from '../playbooks/compiler.js';
import {reportCompilerIssues,resolvePixels,resolveTags} from './routes.js';

const def=(config:object)=>AutomationDefinitionSchema.parse({start:'s',nodes:[{id:'s',kind:'trigger',name:'I',config:{},position:{x:0,y:0}},{id:'p',kind:'pixel',name:'Pixel',config,position:{x:1,y:0}}],edges:[],settings:{}});
const tx:any={metaPixel:{findFirst:async({where}:any)=>where.workspaceId==='w'&&where.name==='Meu pixel'?{id:'clx000000000000000000001'}:null}};

describe('resolvePixels',()=>{
  it('liga o pixel pelo nome no workspace e descarta o nome',async()=>{
    const d=def({pixelName:'Meu pixel',eventName:'Purchase',value:'1',currency:'BRL'});const report:any={items:[],totals:{}};
    await resolvePixels(tx,'w',d,report);
    expect(d.nodes[1]!.config).toEqual({pixelId:'clx000000000000000000001',eventName:'Purchase',value:'1',currency:'BRL'});
    expect(report.items.filter((i:any)=>i.status==='pending')).toHaveLength(0);
    expect(report.items).toEqual([expect.objectContaining({sourceId:'p',sourceType:'pixel',status:'converted'})]);
    expect(report.totals.converted).toBe(1);
  });
  it('nunca confia no pixelId recebido: limpa e registra pendência',async()=>{
    const d=def({pixelId:'clx0000000000000000other',pixelName:'Outro',eventName:'Purchase',value:'1',currency:'BRL'});const report:any={items:[],totals:{}};
    await resolvePixels(tx,'w',d,report);
    expect(d.nodes[1]!.config).not.toHaveProperty('pixelId');
    expect(report.items).toEqual([expect.objectContaining({sourceId:'p',status:'pending',message:'Configure o pixel ‘Outro’ em Configurações.'})]);
    expect(report.totals.pending).toBe(1);
  });
  it('sem nome: limpa pixelId e pede para selecionar',async()=>{
    const d=def({pixelId:'clx0000000000000000other',eventName:'Lead',currency:'BRL'});const report:any={items:[],totals:{}};
    await resolvePixels(tx,'w',d,report);
    expect(d.nodes[1]!.config).not.toHaveProperty('pixelId');expect(report.items[0].message).toContain('Selecione');
  });
});

describe('relatório honesto da importação real',()=>{
  it('cada erro restante do compilador vira pendência e os totais batem',async()=>{
    const raw=JSON.parse(readFileSync(new URL('./fixtures/leona-real-export.redacted.json',import.meta.url),'utf8'));
    const {definition,report}=convertLeonaFlow(raw);
    const tagTx:any={tag:{findUnique:async()=>null,create:async({data}:any)=>({id:`clxtag${data.name}`.padEnd(25,'0')})}};
    await resolveTags(tagTx,'w',definition,report);await resolvePixels(tx,'w',definition,report);reportCompilerIssues(definition,report);
    const errors=(validateAutomation(definition).issues as AutomationIssue[]).filter(issue=>issue.level==='error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(issue=>issue.code==='DUPLICATE_CONNECTION')).toBe(false);
    for(const issue of errors)expect(report.items.some(item=>item.status==='pending'&&item.sourceId===(issue.nodeId??issue.edgeId)&&(item.message===issue.message||issue.code==='INVALID_PIXEL_CONFIG'))).toBe(true);
    expect(report.items).toEqual(expect.arrayContaining([expect.objectContaining({status:'pending',message:'Adicione um desfecho ou handoff para encerrar a jornada.'})]));
    expect(report.items.filter(item=>item.sourceId?.endsWith('5346058'))).toEqual([expect.objectContaining({status:'pending',message:'Configure o pixel ‘PIXEL - MARITZA’ em Configurações.'})]);
    for(const status of ['converted','adjusted','pending'] as const)expect(report.totals[status]).toBe(report.items.filter(item=>item.status===status).length);
  });
});
