import Fastify from 'fastify';
import {describe,expect,it} from 'vitest';
import errors from '../../core/errors.js';
import {playbookRoutes} from './routes.js';

type Row=Record<string,any>;
const matches=(row:Row,where:Row={})=>Object.entries(where).every(([key,value])=>value&&typeof value==='object'&&'not' in value?row[key]!==value.not:row[key]===value);

async function build(permissions=['playbook.read','playbook.write','playbook.publish']){
  const playbooks:Row[]=[
    {id:'pb-live',workspaceId:'ws-a',name:'Ativo',status:'PUBLISHED',activeVersionId:'v1',folderId:null,versions:[{version:2,definition:{nodes:[{id:'a'},{id:'b'},{id:'c'}]}}]},
    {id:'pb-paused',workspaceId:'ws-a',name:'Pausado',status:'PAUSED',activeVersionId:'v2',folderId:null,versions:[]},
    {id:'pb-draft',workspaceId:'ws-a',name:'Rascunho',status:'DRAFT',activeVersionId:null,folderId:null,versions:[]},
    {id:'pb-other',workspaceId:'ws-b',name:'Outro',status:'PUBLISHED',activeVersionId:'v9',folderId:null,versions:[]}
  ];
  const folders:Row[]=[{id:'f-own',workspaceId:'ws-a',name:'Vendas',position:0},{id:'f-other',workspaceId:'ws-b',name:'Alheia',position:0}];
  const audits:Row[]=[];
  const unique=(name:string,workspaceId:string,id?:string)=>{if(folders.some(item=>item.workspaceId===workspaceId&&item.name===name&&item.id!==id))throw Object.assign(new Error('unique'),{code:'P2002'})};
  const prisma={
    playbook:{
      findMany:async({where}:{where:Row})=>playbooks.filter(item=>matches(item,where)).map(item=>({...item,versions:item.versions.slice(0,1)})),
      count:async({where}:{where:Row})=>playbooks.filter(item=>matches(item,where)).length,
      updateMany:async({where,data}:{where:Row;data:Row})=>{const hit=playbooks.filter(item=>matches(item,where));hit.forEach(item=>Object.assign(item,data));return {count:hit.length}}
    },
    playbookFolder:{
      findMany:async({where}:{where:Row})=>folders.filter(item=>matches(item,where)),
      findFirst:async({where}:{where:Row})=>folders.filter(item=>matches(item,where)).sort((a,b)=>b.position-a.position)[0]??null,
      count:async({where}:{where:Row})=>folders.filter(item=>matches(item,where)).length,
      create:async({data}:{data:Row})=>{unique(data.name,data.workspaceId);const row={id:`f-${folders.length+1}`,...data};folders.push(row);return row},
      update:async({where,data}:{where:Row;data:Row})=>{const row=folders.find(item=>item.id===where.id)!;unique(data.name,row.workspaceId,row.id);return Object.assign(row,data)},
      delete:async({where}:{where:Row})=>{folders.splice(folders.findIndex(item=>item.id===where.id),1);playbooks.filter(item=>item.folderId===where.id).forEach(item=>{item.folderId=null})}
    },
    auditLog:{create:async({data}:{data:Row})=>{audits.push(data)}}
  };
  const app=Fastify();app.decorate('prisma',prisma as never);
  app.decorate('requirePermission',((permission:string)=>async(request:any,reply:any)=>{
    if(!permissions.includes(permission))return reply.status(403).send({code:'FORBIDDEN'});
    request.auth={workspaceId:'ws-a',userId:'user-a'};
  }) as never);
  await app.register(errors);
  await app.register(playbookRoutes);
  return {app,playbooks,folders,audits};
}

describe('GET /v1/playbooks',()=>{
  it('lista só o workspace, com folderId e blocos da última versão, sem definições',async()=>{
    const {app}=await build();
    const body=(await app.inject({method:'GET',url:'/v1/playbooks'})).json();
    expect(body.map((item:Row)=>item.id)).toEqual(['pb-live','pb-paused','pb-draft']);
    expect(body[0]).toMatchObject({folderId:null,blocks:3});
    expect(body[1]!.blocks).toBe(0);
    expect(body[0]!.versions).toBeUndefined();
  });
});

describe('pastas',()=>{
  it('lista só as pastas do workspace',async()=>{
    const {app}=await build();
    expect((await app.inject({method:'GET',url:'/v1/playbook-folders'})).json().map((item:Row)=>item.id)).toEqual(['f-own']);
  });
  it('cria no fim da ordem e audita',async()=>{
    const {app,audits}=await build();
    const response=await app.inject({method:'POST',url:'/v1/playbook-folders',payload:{name:'  Suporte '}});
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({name:'Suporte',position:1,workspaceId:'ws-a'});
    expect(audits[0]!.action).toBe('playbook_folder.created');
  });
  it('rejeita nome vazio, longo ou repetido',async()=>{
    const {app}=await build();
    expect((await app.inject({method:'POST',url:'/v1/playbook-folders',payload:{name:' '}})).statusCode).toBe(422);
    expect((await app.inject({method:'POST',url:'/v1/playbook-folders',payload:{name:'x'.repeat(61)}})).statusCode).toBe(422);
    expect((await app.inject({method:'POST',url:'/v1/playbook-folders',payload:{name:'Vendas'}})).statusCode).toBe(409);
  });
  it('exige playbook.write para criar',async()=>{
    const {app}=await build(['playbook.read']);
    expect((await app.inject({method:'POST',url:'/v1/playbook-folders',payload:{name:'X'}})).statusCode).toBe(403);
  });
  it('renomeia e exclui só pastas do workspace',async()=>{
    const {app,folders,playbooks}=await build();
    expect((await app.inject({method:'PATCH',url:'/v1/playbook-folders/f-other',payload:{name:'X'}})).statusCode).toBe(404);
    expect((await app.inject({method:'DELETE',url:'/v1/playbook-folders/f-other'})).statusCode).toBe(404);
    expect((await app.inject({method:'PATCH',url:'/v1/playbook-folders/f-own',payload:{name:'Comercial'}})).json().name).toBe('Comercial');
    playbooks[0]!.folderId='f-own';
    expect((await app.inject({method:'DELETE',url:'/v1/playbook-folders/f-own'})).statusCode).toBe(204);
    expect(folders.map(item=>item.id)).toEqual(['f-other']);
    expect(playbooks[0]!.folderId).toBeNull();
  });
});

describe('PATCH /v1/playbooks/:id/folder',()=>{
  it('move para pasta do workspace e volta para sem pasta',async()=>{
    const {app,playbooks,audits}=await build();
    expect((await app.inject({method:'PATCH',url:'/v1/playbooks/pb-live/folder',payload:{folderId:'f-own'}})).statusCode).toBe(200);
    expect(playbooks[0]!.folderId).toBe('f-own');
    await app.inject({method:'PATCH',url:'/v1/playbooks/pb-live/folder',payload:{folderId:null}});
    expect(playbooks[0]!.folderId).toBeNull();
    expect(audits.map(item=>item.action)).toEqual(['playbook.folder_changed','playbook.folder_changed']);
  });
  it('recusa pasta ou fluxo de outro workspace',async()=>{
    const {app,playbooks}=await build();
    expect((await app.inject({method:'PATCH',url:'/v1/playbooks/pb-live/folder',payload:{folderId:'f-other'}})).statusCode).toBe(404);
    expect((await app.inject({method:'PATCH',url:'/v1/playbooks/pb-other/folder',payload:{folderId:'f-own'}})).statusCode).toBe(404);
    expect(playbooks[0]!.folderId).toBeNull();
    expect(playbooks[3]!.folderId).toBeNull();
  });
});

describe('pausar e retomar',()=>{
  it('pausa somente fluxo publicado',async()=>{
    const {app,playbooks,audits}=await build();
    const response=await app.inject({method:'POST',url:'/v1/playbooks/pb-live/pause'});
    expect(response.statusCode).toBe(200);
    expect(playbooks[0]!.status).toBe('PAUSED');
    expect(audits[0]!.action).toBe('playbook.paused');
    const again=await app.inject({method:'POST',url:'/v1/playbooks/pb-draft/pause'});
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('PLAYBOOK_NOT_ACTIVE');
    expect((await app.inject({method:'POST',url:'/v1/playbooks/pb-other/pause'})).statusCode).toBe(404);
    expect(playbooks[3]!.status).toBe('PUBLISHED');
  });
  it('retoma somente fluxo pausado com versão ativa',async()=>{
    const {app,playbooks,audits}=await build();
    expect((await app.inject({method:'POST',url:'/v1/playbooks/pb-paused/resume'})).statusCode).toBe(200);
    expect(playbooks[1]!.status).toBe('PUBLISHED');
    expect(audits[0]!.action).toBe('playbook.resumed');
    expect((await app.inject({method:'POST',url:'/v1/playbooks/pb-live/resume'})).statusCode).toBe(409);
    playbooks[2]!.status='PAUSED';
    expect((await app.inject({method:'POST',url:'/v1/playbooks/pb-draft/resume'})).statusCode).toBe(409);
  });
  it('exige playbook.publish',async()=>{
    const {app}=await build(['playbook.read','playbook.write']);
    expect((await app.inject({method:'POST',url:'/v1/playbooks/pb-live/pause'})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/v1/playbooks/pb-paused/resume'})).statusCode).toBe(403);
  });
});
