import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import Fastify from 'fastify';
import {createHmac} from 'node:crypto';
import {webhookRoutes} from './routes.js';

const SECRET='test_app_secret';
const sign=(body:string|Buffer,secret=SECRET)=>'sha256='+createHmac('sha256',secret).update(body).digest('hex');
const env={...process.env};
const upsert=vi.fn();

async function build(){
  const app=Fastify({logger:false});
  app.decorate('prisma',{rawWebhookEvent:{upsert}} as never);
  app.decorate('requirePermission',(()=>async()=>{}) as never);
  const warn=vi.fn();
  app.addHook('onRequest',async request=>{request.log={...request.log,warn,error:vi.fn()} as never});
  await app.register(webhookRoutes);
  return {app,warn};
}
const post=(app:Awaited<ReturnType<typeof build>>['app'],payload:string,headers:Record<string,string>={})=>app.inject({method:'POST',url:'/v1/webhooks/meta',payload,headers:{'content-type':'application/json',...headers}});

describe('webhook Meta',()=>{
  beforeEach(()=>{upsert.mockReset();upsert.mockResolvedValue({});process.env.META_APP_SECRET=SECRET;process.env.META_VERIFY_TOKEN='verify';process.env.NODE_ENV='test'});
  afterEach(()=>{process.env={...env}});

  it('assinatura válida passa e grava',async()=>{
    const {app}=await build();const body='{"entry":[{"changes":[{"value":{"messages":[{"id":"m1"}]}}]}]}';
    const res=await post(app,body,{'x-hub-signature-256':sign(body)});
    expect(res.statusCode).toBe(200);expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0]![0].where.provider_externalId.externalId).toBe('m1');
  });
  it('assinatura inválida ou ausente retorna 401, não grava e loga warn sem payload',async()=>{
    const {app,warn}=await build();const body='{"secret_marker":"PAYLOAD_XYZ"}';
    for(const headers of <Record<string,string>[]>[{'x-hub-signature-256':sign(body,'outro')},{'x-hub-signature-256':'sha256=abc'},{}]){
      const res=await post(app,body,headers);expect(res.statusCode).toBe(401);
    }
    expect(upsert).not.toHaveBeenCalled();expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('PAYLOAD_XYZ');
  });
  it('sem META_APP_SECRET em produção recusa com 503 e não grava',async()=>{
    delete process.env.META_APP_SECRET;process.env.NODE_ENV='production';
    const {app}=await build();const res=await post(app,'{"a":1}');
    expect(res.statusCode).toBe(503);expect(res.json().code).toBe('META_WEBHOOK_NOT_CONFIGURED');expect(upsert).not.toHaveBeenCalled();
  });
  it('sem segredo fora de produção aceita com warn',async()=>{
    delete process.env.META_APP_SECRET;const {app,warn}=await build();
    const res=await post(app,'{"a":1}');expect(res.statusCode).toBe(200);expect(upsert).toHaveBeenCalledTimes(1);expect(warn).toHaveBeenCalled();
  });
  it('valida sobre bytes brutos mesmo com espaçamento diferente do JSON.stringify',async()=>{
    const {app}=await build();const body='{ "z": 1,\n  "entry" : [ {"changes":[{"value":{"messages":[{"id":"m2"}]}}]} ] , "a":"é\\u00e9" }';
    expect(body).not.toBe(JSON.stringify(JSON.parse(body)));
    expect((await post(app,body,{'x-hub-signature-256':sign(body)})).statusCode).toBe(200);
    expect((await post(app,body,{'x-hub-signature-256':sign(JSON.stringify(JSON.parse(body)))})).statusCode).toBe(401);
  });
  it('GET de verificação continua funcionando',async()=>{
    const {app}=await build();
    const ok=await app.inject({method:'GET',url:'/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=abc123'});
    expect(ok.statusCode).toBe(200);expect(ok.body).toBe('abc123');
    const bad=await app.inject({method:'GET',url:'/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=x&hub.challenge=abc'});
    expect(bad.statusCode).toBe(403);
  });
});
