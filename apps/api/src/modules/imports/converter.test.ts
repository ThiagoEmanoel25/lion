import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe,expect,it} from 'vitest';
import {AutomationDefinitionSchema} from '@nexo/contracts';
import {convertLeonaFlow,isLeonaHostedUrl,redactDefinitionSecrets} from './converter.js';
import {validateAutomation} from '../playbooks/compiler.js';

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
    expect(cfg('pixel')[0]).toMatchObject({eventName:'Purchase',value:'15',currency:'BRL',pageId:'<page-id>',pixelName:'PIXEL - MARITZA'});
    expect(cfg('pixel')[0]).not.toHaveProperty('pixelId');
    expect(items.some(item=>item.sourceType==='pixel'&&item.status==='pending')).toBe(false);
    expect(items.some(item=>item.sourceType==='ai'&&item.message.includes('chave'))).toBe(true);
    expect(result.definition.nodes.find(node=>node.kind==='trigger')!.config).toMatchObject({event:'message.received',oncePerContact:true});
    expect(items.some(item=>item.status==='pending'&&item.message.startsWith('O gatilho da Leona não vem no export'))).toBe(true);
    for(const id of ['5345054','5346541'])expect(items.filter(item=>item.sourceId===id&&/arquivo\(s\) continuam hospedados na Leona/.test(item.message))).toHaveLength(1);
    expect(JSON.stringify(result.definition)).toContain('leona-production.b-cdn.net');
  });

  it('isLeonaHostedUrl reconhece o CDN da Leona',()=>{
    expect(isLeonaHostedUrl('https://leona-production.b-cdn.net/abc')).toBe(true);
    expect(isLeonaHostedUrl('https://x.b-cdn.net/abc')).toBe(true);
    expect(isLeonaHostedUrl('https://cdn.leona.com.br/abc')).toBe(true);
    expect(isLeonaHostedUrl('https://example.com/b-cdn.net')).toBe(false);
    expect(isLeonaHostedUrl('não é url')).toBe(false);
  });

  it('export real: pixel ganha saídas sucesso e falha, condição sem efeito é removida e pixel não conta como convertido',()=>{
    const result=convertLeonaFlow(load('leona-real-export.redacted.json'));const {edges,nodes}=result.definition;
    const pixelOut=edges.filter(edge=>edge.source==='leona_5346058');
    expect(pixelOut.map(edge=>edge.port).sort()).toEqual(['failure','success']);
    expect(new Set(pixelOut.map(edge=>edge.target))).toEqual(new Set(['leona_5346068']));
    expect(new Set(edges.map(edge=>edge.id)).size).toBe(edges.length);
    expect(nodes.some(node=>node.id==='leona_5343660')).toBe(false);
    expect(edges).toEqual(expect.arrayContaining([expect.objectContaining({source:'leona_5343625',target:'leona_5343987'})]));
    expect(edges.some(edge=>edge.source==='leona_5343660'||edge.target==='leona_5343660')).toBe(false);
    expect(result.report.items).toEqual(expect.arrayContaining([{sourceId:'5343660',sourceType:'condition',status:'adjusted',message:'Condição sem efeito removida: os dois caminhos iam para o mesmo bloco'}]));
    expect(result.report.items.some(item=>item.sourceId==='5346058'&&item.status==='converted')).toBe(false);
    expect(validateAutomation(result.definition).issues.some(issue=>issue.code==='DUPLICATE_CONNECTION')).toBe(false);
  });

  it('mantém modo remove das etiquetas e corpo de requisição em objeto',()=>{
    const node=(id:string,type:string,action_type:string,config:object)=>({id,type,data:{actions:[{action_type,config,order:1}]}});
    const result=convertLeonaFlow({nodes:[node('s','start','x',{}),node('t','tags','add_tags',{tags:['A'],action:'remove'}),node('h','integration','make_http_request',{request_url:'https://api.example.com/x',request_method:'POST',request_body:{phone:'{phone_number}'}})],edges:[]});
    expect(result.definition.nodes.find(n=>n.kind==='tag')?.config).toMatchObject({mode:'remove',tags:['A']});
    expect(result.definition.nodes.find(n=>n.kind==='webhook')?.config.body).toBe('{"phone":"{{contact.phone}}"}');
  });

  it('pixel: mapeia rótulos e marca rastreador diferente de Facebook como pendência',()=>{
    const node=(id:string,type:string,action_type:string,config:object)=>({id,type,data:{actions:[{action_type,config,order:1}]}});
    const convert=(config:object)=>convertLeonaFlow({nodes:[node('s','start','x',{}),node('p','pixel','send_pixel_event',config)],edges:[]});
    const lead=convert({event_type:'Lead',currency:'USD',tracking_type:'Facebook',pixel_config_name:'P'});
    expect(lead.definition.nodes.find(n=>n.kind==='pixel')?.config).toMatchObject({eventName:'LeadSubmitted',currency:'USD'});
    expect(lead.report.items.some(item=>item.sourceType==='pixel'&&item.status==='pending')).toBe(false);
    const other=convert({event_type:'Compra',item_value:'1',tracking_type:'Google',pixel_config_name:'P'});
    expect(other.report.items.some(item=>item.sourceType==='pixel'&&item.status==='pending'&&item.message.includes('Google'))).toBe(true);
    const unknown=convert({event_type:'Xyz',tracking_type:'Facebook',pixel_config_name:'P'});
    expect(unknown.report.items.some(item=>item.sourceType==='pixel'&&item.status==='pending'&&item.message.includes('Xyz'))).toBe(true);
  });

  it('divide a mensagem embutida antes da espera e preserva gravação, reação e citação',()=>{
    const result=convertLeonaFlow(load('leona-gaps.redacted.json'));const wait=result.definition.nodes.find(node=>node.id==='leona_wait');const message=result.definition.nodes.find(node=>node.id==='leona_wait_message');
    expect(message).toMatchObject({kind:'message',config:{items:[{type:'text',text:'Qual é sua resposta?',typingSeconds:0}]},position:{x:200,y:0}});
    expect(wait).toMatchObject({kind:'wait_response',position:{x:240,y:40},config:{waitIndefinitely:false,timeoutValue:10,timeoutUnit:'minutes',bufferSeconds:5,saveReplyTo:'resposta-lead',saveEmpty:false,reactEmoji:'🎉',replyToLeadCount:2}});
    expect(result.definition.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({source:'leona_start',target:'leona_wait_message'}),
      expect.objectContaining({source:'leona_wait_message',target:'leona_wait'}),
      expect.objectContaining({source:'leona_wait',target:'leona_condition',port:'reply'}),
      expect.objectContaining({source:'leona_wait',target:'leona_notify',port:'timeout'})
    ]));
    expect(result.report.items).toEqual(expect.arrayContaining([expect.objectContaining({sourceId:'wait',status:'adjusted',message:expect.stringContaining('separada')})]));
  });

  it('mapeia salto, distribuidor, notificação e propriedades de áudio sem copiar segredos',()=>{
    const result=convertLeonaFlow(load('leona-gaps.redacted.json'));const node=(kind:string)=>result.definition.nodes.find(item=>item.kind===kind)!;
    expect(node('flow_jump').config).toEqual({leonaFlowId:140148,targetName:'FUNIL 02'});
    expect(node('distributor').config).toEqual({outputs:[{id:'output_a',name:'A',weight:1},{id:'output_b',name:'B',weight:1}],preventRepeat:true});
    expect(result.definition.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({source:'leona_dist',target:'leona_audio',condition:{field:'distributor.output',operator:'equals',value:'output_a'}}),
      expect.objectContaining({source:'leona_dist',target:'leona_notify',condition:{field:'distributor.output',operator:'equals',value:'output_b'}})
    ]));
    expect(node('notification').config).toEqual({phone:'+5500000000000',message:'Erro: {{ai.fail.reason}}',name:'ERRO IA'});
    expect((node('message').config.items as Array<Record<string,unknown>>)[0]).toMatchObject({type:'media',mediaType:'audio',typingSeconds:42,forwarded:true,ptt:true});
    expect(JSON.stringify(result)).not.toMatch(/Authorization|api[_-]?key/i);
    expect(result.report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({sourceId:'dist',status:'adjusted',message:'Contadores do distribuidor recomeçam do zero.'}),
      expect.objectContaining({sourceId:'jump',status:'pending',message:expect.stringContaining('FUNIL 02')})
    ]));
  });

  it('distingue variáveis produzidas no fluxo de campos persistentes do contato',()=>{
    const result=convertLeonaFlow(load('leona-gaps.redacted.json'));const rules=result.definition.nodes.find(node=>node.id==='leona_condition')!.config.rules;
    expect(rules).toEqual([
      {field:'resposta.gpt',operator:'contains',value:'ok'},
      {field:'api.result',operator:'equals',value:'yes'},
      {field:'contact.customFields.resposta-lead',operator:'not_equals',value:''}
    ]);
  });

  it.each([
    ['leona-funil-01.redacted.json',21,30,{converted:13,adjusted:4,pending:2}],
    ['leona-funil-02.redacted.json',16,20,{converted:13,adjusted:1,pending:2}],
    ['leona-funil-03.redacted.json',15,18,{converted:7,adjusted:0,pending:7}],
    ['leona-funil-04.redacted.json',20,32,{converted:12,adjusted:0,pending:7}],
    ['leona-funil-05.redacted.json',18,22,{converted:14,adjusted:2,pending:3}]
  ] as const)('converte a fixture redigida %s com topologia e relatório estáveis',(file,nodeCount,edgeCount,totals)=>{
    const raw=load(file);const serialized=JSON.stringify(raw);const result=convertLeonaFlow(raw);
    expect(result.definition.nodes).toHaveLength(nodeCount);expect(result.definition.edges).toHaveLength(edgeCount);expect(result.report.totals).toEqual(totals);
    expect(result.definition.nodes.filter(node=>node.kind==='message').flatMap(node=>Array.isArray(node.config.items)?node.config.items:[]).some(item=>typeof item==='object'&&item!==null&&(item as {text?:unknown}).text==='Mensagem importada — revise o conteúdo.')).toBe(false);
    expect(serialized).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{10,}|sk-[A-Za-z0-9_-]{10,}/);
    expect(serialized).not.toMatch(/71988260588|71991399242/);
  });

  it('fixtures completas preservam rotas de distribuidores, saltos e o campo persistente entre fluxos',()=>{
    const first=convertLeonaFlow(load('leona-funil-01.redacted.json')).definition;const second=convertLeonaFlow(load('leona-funil-02.redacted.json')).definition;const third=convertLeonaFlow(load('leona-funil-03.redacted.json')).definition;
    const distributorEdges=first.edges.filter(edge=>edge.condition?.field==='distributor.output');
    expect(distributorEdges).toHaveLength(10);expect(new Set(distributorEdges.map(edge=>edge.condition?.value)).size).toBe(5);
    expect(second.nodes.filter(node=>node.kind==='wait_response').map(node=>node.config)).toEqual(expect.arrayContaining([expect.objectContaining({saveReplyTo:'resposta-lead',saveEmpty:true}),expect.objectContaining({saveReplyTo:'resposta-lead',reactEmoji:'🎉',replyToLeadCount:1})]));
    const persistedRules=third.nodes.filter(node=>node.kind==='condition').flatMap(node=>Array.isArray(node.config.rules)?node.config.rules:[]);
    expect(persistedRules).toEqual(expect.arrayContaining([expect.objectContaining({field:'contact.customFields.resposta-lead'})]));
    expect([...first.nodes,...second.nodes,...third.nodes].filter(node=>node.kind==='flow_jump').every(node=>node.config.leonaFlowId!==undefined&&typeof node.config.targetName==='string')).toBe(true);
  });
});
