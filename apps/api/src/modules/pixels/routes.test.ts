import {describe,expect,it} from 'vitest';
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
});
