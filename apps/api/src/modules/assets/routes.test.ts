import Fastify from 'fastify';
import {describe,expect,it} from 'vitest';
import errors from '../../core/errors.js';
import {assetRoutes} from './routes.js';

const ID='a'.repeat(24);
const PNG=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(16)]);
async function build(stored:Record<string,any>={}){
  const prisma={playbookAsset:{
    create:async({data}:any)=>({id:ID,...data}),
    findFirst:async()=>stored.row??null
  }};
  const app=Fastify();app.decorate('prisma',prisma as never);
  app.decorate('requirePermission',(()=>async(request:any)=>{request.auth={workspaceId:'ws-a',userId:'u'}}) as never);
  await app.register(errors);await app.register(assetRoutes);return app;
}
const upload=(app:any,type:string,name:string,body:Buffer)=>app.inject({method:'POST',url:'/v1/playbook-assets',headers:{'content-type':'application/octet-stream','x-file-name':encodeURIComponent(name),'x-file-content-type':type},payload:body});

describe('assets seguros',()=>{
  it('aceita PNG válido',async()=>{const r=await upload(await build(),'image/png','a.png',PNG);expect(r.statusCode).toBe(201);expect(r.json().contentType).toBe('image/png')});
  it('recusa text/html e image/svg+xml com 415',async()=>{
    const app=await build();
    for(const [t,n] of [['text/html','a.html'],['image/svg+xml','a.svg']] as Array<[string,string]>){const r=await upload(app,t,n,Buffer.from('<svg onload=alert(1)>'));expect(r.statusCode).toBe(415);expect(r.json().code).toBe('ASSET_TYPE_NOT_ALLOWED')}
  });
  it('recusa octet-stream sem extensão conhecida',async()=>{expect((await upload(await build(),'application/octet-stream','x.html',Buffer.from('<html>'))).statusCode).toBe(415)});
  it('recusa PNG declarado com conteúdo HTML e extensão contraditória',async()=>{
    const app=await build();
    const a=await upload(app,'image/png','a.png',Buffer.from('<html><script>alert(1)</script></html>'));expect(a.statusCode).toBe(415);expect(a.json().code).toBe('ASSET_TYPE_MISMATCH');
    expect((await upload(app,'image/png','a.html',PNG)).statusCode).toBe(415);
  });
  it('download de PNG inline com nosniff e CSP',async()=>{
    const app=await build({row:{data:PNG,fileName:'a.png',contentType:'image/png'}});
    const r=await app.inject({method:'GET',url:`/v1/playbook-assets/${ID}`});
    expect(r.headers['content-type']).toBe('image/png');expect(String(r.headers['content-disposition'])).toMatch(/^inline/);expect(r.headers['x-content-type-options']).toBe('nosniff');expect(r.headers['content-security-policy']).toBe("sandbox; default-src 'none'");
  });
  it('asset legado text/html sai como attachment octet-stream',async()=>{
    for(const t of ['text/html','image/svg+xml']){
      const app=await build({row:{data:Buffer.from('<script>alert(1)</script>'),fileName:'x.html',contentType:t}});
      const r=await app.inject({method:'GET',url:`/v1/playbook-assets/${ID}`});
      expect(r.headers['content-type']).toBe('application/octet-stream');expect(String(r.headers['content-disposition'])).toMatch(/^attachment/);expect(r.headers['x-content-type-options']).toBe('nosniff');expect(r.headers['content-security-policy']).toBe("sandbox; default-src 'none'");
    }
  });
  it('PDF inline',async()=>{
    const app=await build({row:{data:Buffer.from('%PDF-1.4'),fileName:'a.pdf',contentType:'application/pdf'}});
    const r=await app.inject({method:'GET',url:`/v1/playbook-assets/${ID}`});
    expect(r.headers['content-type']).toBe('application/pdf');expect(String(r.headers['content-disposition'])).toMatch(/^inline/);
  });
});
