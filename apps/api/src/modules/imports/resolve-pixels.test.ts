import {describe,expect,it} from 'vitest';
import {AutomationDefinitionSchema} from '@nexo/contracts';
import {resolvePixels} from './routes.js';

const def=(config:object)=>AutomationDefinitionSchema.parse({start:'s',nodes:[{id:'s',kind:'trigger',name:'I',config:{},position:{x:0,y:0}},{id:'p',kind:'pixel',name:'Pixel',config,position:{x:1,y:0}}],edges:[],settings:{}});
const tx:any={metaPixel:{findFirst:async({where}:any)=>where.workspaceId==='w'&&where.name==='Meu pixel'?{id:'clx000000000000000000001'}:null}};

describe('resolvePixels',()=>{
  it('liga o pixel pelo nome no workspace e descarta o nome',async()=>{
    const d=def({pixelName:'Meu pixel',eventName:'Purchase',value:'1',currency:'BRL'});const report:any={items:[],totals:{}};
    await resolvePixels(tx,'w',d,report);
    expect(d.nodes[1]!.config).toEqual({pixelId:'clx000000000000000000001',eventName:'Purchase',value:'1',currency:'BRL'});
    expect(report.items.filter((i:any)=>i.status==='pending')).toHaveLength(0);
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
