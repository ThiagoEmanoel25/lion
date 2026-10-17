import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe,expect,it} from 'vitest';
import {AutomationDefinitionSchema} from '@nexo/contracts';
import {convertLeonaFlow,redactDefinitionSecrets} from './converter.js';

const load=(name:string)=>JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`,import.meta.url)),'utf8'));
const fixture=load('leona-flow.redacted.json');

describe('conversor Leona',()=>{
  it('converte blocos conhecidos, variáveis e desvia blocos no-op',()=>{
    const result=convertLeonaFlow(fixture);
    expect(()=>AutomationDefinitionSchema.parse(result.definition)).not.toThrow();
    expect(result.definition.nodes.map(node=>node.kind)).toEqual(['trigger','message','wait_response','condition','ai','webhook','tag']);
    const messageItems=result.definition.nodes.find(node=>node.kind==='message')?.config.items as Array<Record<string,unknown>>;
    expect(messageItems[0]).toMatchObject({type:'text',text:'Olá {{contact.firstName}}: {{contact.customFields.link_grupo}}'});
    expect(messageItems.map(item=>item.type)).toEqual(['text','pause','file']);
    expect(result.definition.nodes.find(node=>node.kind==='ai')?.config).not.toHaveProperty('api_key');
    expect(result.definition.nodes.find(node=>node.kind==='webhook')?.config.headers).toEqual({'X-Trace':'fixture'});
    expect(result.definition.edges.some(edge=>edge.source==='leona_7'&&edge.target==='leona_2')).toBe(true);
    expect(result.report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({sourceType:'kanban',status:'adjusted'}),
      expect.objectContaining({sourceType:'pixel',status:'pending'}),
      expect.objectContaining({sourceType:'ai',status:'pending'})
    ]));
    expect(result.report.items.some(item=>item.message.includes('link_grupo'))).toBe(true);
  });

  it('remove segredos de snapshots compartilháveis',()=>{
    const definition=AutomationDefinitionSchema.parse({start:'start',nodes:[
      {id:'start',kind:'trigger',name:'Início',config:{event:'message.received'},position:{x:0,y:0}},
      {id:'hook',kind:'webhook',name:'HTTP',config:{url:'https://example.com',method:'POST',headers:{Authorization:'Bearer segredo','X-Trace':'ok'},responseFields:[]},position:{x:200,y:0}}
    ],edges:[{id:'e',source:'start',target:'hook'}],settings:{maxSteps:30,timeoutSeconds:300}});
    const result=redactDefinitionSecrets(definition);const hook=result.definition.nodes.find(node=>node.id==='hook');
    expect(hook?.config.headers).toEqual({'X-Trace':'ok'});
    expect(result.report.totals.pending).toBe(1);
  });

  it('converte uma ação Kanban por nome para resolução no workspace de destino',()=>{
    const result=convertLeonaFlow({nodes:[
      {id:'start',type:'start',position:{x:0,y:0}},
      {id:'board',type:'kanban',position:{x:200,y:0},data:{action:{board:{name:'Comercial'},column:{name:'Qualificado'}},mode:'move_only'}}
    ],edges:[{id:'edge',source:'start',target:'board'}]});
    const node=result.definition.nodes.find(item=>item.kind==='kanban');
    expect(node?.config).toEqual({boardName:'Comercial',columnName:'Qualificado',mode:'move_only'});
    expect(result.report.items).toEqual(expect.arrayContaining([expect.objectContaining({sourceType:'kanban',status:'adjusted'})]));
  });

  it('normaliza condição de etiqueta da Leona para referências resolvíveis por nome',()=>{
    const result=convertLeonaFlow({nodes:[
      {id:'start',type:'start',position:{x:0,y:0}},
      {id:'condition',type:'condition',position:{x:200,y:0},data:{conditions:[{field:'system/tag',operator:'different',value:{name:'Cliente VIP'}}]}}
    ],edges:[{id:'edge',source:'start',target:'condition'}]});
    expect(result.definition.nodes.find(item=>item.kind==='condition')?.config.rules).toEqual([{field:'contact.tagIds',operator:'not_in',value:['Cliente VIP']}]);
  });

  it('lê o export real da Leona (data.actions[]) sem perder conteúdo',()=>{
    const raw=load('leona-real-export.redacted.json');const result=convertLeonaFlow(raw);
    expect(()=>AutomationDefinitionSchema.parse(result.definition)).not.toThrow();
    const cfg=(kind:string)=>result.definition.nodes.filter(node=>node.kind===kind).map(node=>node.config as Record<string,any>);
    const texts=cfg('message').flatMap(config=>(config.items as any[]).filter(item=>item.type==='text').map(item=>item.text as string));
    expect(texts.length).toBeGreaterThan(5);
    expect(texts.some(value=>value.includes('Mensagem importada'))).toBe(false);
    expect(texts[0]).toContain('{{contact.customFields.link_grupo}}');
    const waits=cfg('wait_response');
    expect(waits.map(config=>config.timeoutValue).sort()).toEqual([20,20,31,31,31]);
    expect(waits.every(config=>config.timeoutUnit==='days'&&config.bufferSeconds===0)).toBe(true);
    expect(waits.filter(config=>config.waitIndefinitely).length).toBe(3);
    const hook=cfg('webhook')[0]!;
    expect(hook.url).toBe('https://api.kovil.com.br/integrations/leona/receipts/8039/resolve');
    expect(hook.responseFields.map((field:any)=>field.variable).sort()).toEqual(['kovil.receipt.accepted','kovil.receipt.duplicate','kovil.receipt.error']);
    expect(hook.headers).toEqual({'Content-Type':'application/json'});
    expect(hook.body).toContain('{{contact.phone}}');
    const rules=cfg('condition').flatMap(config=>config.rules as any[]);
    expect(rules).toEqual(expect.arrayContaining([
      {field:'contact.tagIds',operator:'in',value:['venda-atendente']},
      {field:'resposta.gpt',operator:'contains',value:'#R$'},
      {field:'resposta.gpt',operator:'not_contains',value:'#R$0,00'}
    ]));
    const ai=cfg('ai')[0]!;
    expect(ai.systemPrompt).toContain('comprovantes de pagamento');
    expect(ai.userMessage).toBe('{{last_message}}');
    expect(ai.understandImage).toBe(true);
    expect(JSON.stringify(result)).not.toContain('<redacted>');
    expect(JSON.stringify(result)).not.toContain('Authorization');
    expect(cfg('tag')[0]).toMatchObject({mode:'add',tags:['PAGOUUPSELL']});
    const {items,totals}=result.report;
    for(const status of ['converted','adjusted','pending'] as const)expect(totals[status]).toBe(items.filter(item=>item.status===status).length);
    expect(items.some(item=>item.sourceType==='pixel'&&item.status==='pending')).toBe(true);
    expect(items.some(item=>item.sourceType==='ai'&&item.message.includes('chave'))).toBe(true);
  });
});
