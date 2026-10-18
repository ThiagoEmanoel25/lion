import Fastify from 'fastify';
import {describe,expect,it} from 'vitest';
import {playbookRoutes} from './routes.js';

async function build(granted=true){
  const counts=[
    {playbookId:'pb-own',nodeId:'dist-1',outputId:'a',count:3},
    {playbookId:'pb-own',nodeId:'dist-1',outputId:'b',count:2},
    {playbookId:'pb-other',nodeId:'dist-x',outputId:'x',count:99}
  ];
  const prisma={
    playbook:{count:async({where}:{where:{id:string;workspaceId:string}})=>Number(where.id==='pb-own'&&where.workspaceId==='workspace-a')},
    flowDistributorCount:{findMany:async({where}:{where:{playbookId:string}})=>counts.filter(item=>item.playbookId===where.playbookId).map(({nodeId,outputId,count})=>({nodeId,outputId,count}))}
  };
  const app=Fastify();app.decorate('prisma',prisma as never);app.decorate('requirePermission',((_permission:string)=>async(request:any,reply:any)=>{
    if(!granted)return reply.status(403).send({code:'FORBIDDEN'});
    request.auth={workspaceId:'workspace-a',userId:'user-a'};
  }) as never);
  await app.register(playbookRoutes);return app;
}

describe('GET /v1/playbooks/:id/distributors',()=>{
  it('exige playbook.read',async()=>{
    const response=await (await build(false)).inject({method:'GET',url:'/v1/playbooks/pb-own/distributors'});
    expect(response.statusCode).toBe(403);
  });
  it('isola o playbook pelo workspace',async()=>{
    const response=await (await build()).inject({method:'GET',url:'/v1/playbooks/pb-other/distributors'});
    expect(response.statusCode).toBe(404);
  });
  it('agrupa os contadores por nó e saída',async()=>{
    const response=await (await build()).inject({method:'GET',url:'/v1/playbooks/pb-own/distributors'});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({items:[{nodeId:'dist-1',outputs:[{outputId:'a',count:3},{outputId:'b',count:2}]}]});
  });
});
