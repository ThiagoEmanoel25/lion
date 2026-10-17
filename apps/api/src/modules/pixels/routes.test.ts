import {describe,expect,it,vi,afterEach} from 'vitest';
import Fastify from 'fastify';
import {pixelRoutes} from './routes.js';

process.env.FIELD_ENCRYPTION_KEY=Buffer.alloc(32,1).toString('base64');
const TOKEN='EAAB-super-secret-token-9876';
async function build(){
  const rows:any[]=[];const audits:any[]=[];
  const prisma:any={
    auditLog:{create:async({data}:any)=>{audits.push(data)}},
    metaPixel:{
      findMany:async()=>rows,
      create:async({data}:any)=>{const row={id:'clx000000000000000000009',createdAt:new Date(),updatedAt:new Date(),pageId:null,testEventCode:null,...data};rows.push(row);return row},
      findFirst:async({where}:any)=>rows.find(r=>r.id===where.id)??null,
      update:async({where,data}:any)=>Object.assign(rows.find(r=>r.id===where.id),data),
      delete:async({where}:any)=>{rows.splice(rows.findIndex(r=>r.id===where.id),1)}
    }
  };
  const app=Fastify();
  let count=0;app.decorate('redis',{eval:async()=>++count} as any);
  app.decorate('prisma',prisma);app.decorate('requirePermission',(()=>async(request:any)=>{request.auth={workspaceId:'w',userId:'u'}}) as any);
  await app.register(pixelRoutes);
  return {app,rows,audits};
}

describe('rotas de pixel',()=>{
  it('nunca devolve nem audita o token',async()=>{
    const {app,rows,audits}=await build();
    const created=await app.inject({method:'POST',url:'/v1/workspace/pixels',payload:{name:'P1',pixelId:'123456',accessToken:TOKEN,testEventCode:'TEST1'}});
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({name:'P1',pixelId:'123456',tokenLast4:'9876',testEventCode:'TEST1'});
    expect(rows[0].accessTokenEncrypted).not.toContain(TOKEN);
    const list=await app.inject({method:'GET',url:'/v1/workspace/pixels'});
    const patched=await app.inject({method:'PATCH',url:`/v1/workspace/pixels/${rows[0].id}`,payload:{name:'P2'}});
    expect(patched.json()).toMatchObject({name:'P2',tokenLast4:'9876'});
    const del=await app.inject({method:'DELETE',url:`/v1/workspace/pixels/${rows[0].id}`});
    expect(del.statusCode).toBe(204);
    for(const body of [created.body,list.body,patched.body,JSON.stringify(audits)]){expect(body).not.toContain(TOKEN);expect(body).not.toContain('accessTokenEncrypted')}
    expect(audits.map(a=>a.action)).toEqual(['pixel.created','pixel.updated','pixel.deleted']);
  });

  afterEach(()=>vi.unstubAllGlobals());
  const seed=async(testEventCode:string|null)=>{const ctx=await build();await ctx.app.inject({method:'POST',url:'/v1/workspace/pixels',payload:{name:'P1',pixelId:'123456',accessToken:TOKEN,testEventCode}});return ctx};
  it('teste: exige testEventCode',async()=>{
    const {app,rows}=await seed(null);
    const res=await app.inject({method:'POST',url:`/v1/workspace/pixels/${rows[0].id}/test-event`});
    expect(res.statusCode).toBe(422);expect(res.json().code).toBe('PIXEL_TEST_CODE_REQUIRED');
  });
  it('teste: envia evento com ctwa de teste e nunca devolve o token',async()=>{
    const {app,rows}=await seed('TEST1');
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify({events_received:1}),{status:200}));vi.stubGlobal('fetch',fetchMock);
    const res=await app.inject({method:'POST',url:`/v1/workspace/pixels/${rows[0].id}/test-event`});
    expect(res.statusCode).toBe(200);expect(res.json()).toEqual({ok:true,status:200,eventsReceived:1,message:expect.any(String)});
    const [url,init]=fetchMock.mock.calls[0] as any;const body=JSON.parse(init.body);
    expect(url).not.toContain(TOKEN);expect(body.access_token).toBe(TOKEN);expect(body.test_event_code).toBe('TEST1');
    expect(body.data[0].user_data.ctwa_clid).toBe('TEST_CTWA_CLID');expect(body.data[0].event_id).toBeTruthy();
    expect(res.body).not.toContain(TOKEN);
  });
  it('teste: falha da Meta vira ok=false sem token',async()=>{
    const {app,rows}=await seed('TEST1');
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:{message:'Invalid token'}}),{status:400})));
    const res=await app.inject({method:'POST',url:`/v1/workspace/pixels/${rows[0].id}/test-event`});
    expect(res.json()).toMatchObject({ok:false,status:400,eventsReceived:0,message:'Invalid token'});
  });
  it('teste: limita a 5 por minuto',async()=>{
    const {app,rows}=await seed('TEST1');vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({events_received:1}))));
    const codes=[];for(let i=0;i<6;i++)codes.push((await app.inject({method:'POST',url:`/v1/workspace/pixels/${rows[0].id}/test-event`})).statusCode);
    expect(codes).toEqual([200,200,200,200,200,429]);
  });
});
