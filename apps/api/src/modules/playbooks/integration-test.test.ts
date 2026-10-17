import {describe,expect,it} from 'vitest';
import {assertPublicHttpsUrl,isPrivateAddress} from '@nexo/domain';
import {IntegrationUrlBlockedError,integrationTestRateLimit,testIntegrationRequest} from './integration-test.js';

describe('segurança da integração',()=>{
  it('bloqueia endereços locais e privados',async()=>{
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('10.1.2.3')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    await expect(assertPublicHttpsUrl('https://localhost/admin')).rejects.toThrow('endereços internos');
    await expect(assertPublicHttpsUrl('https://192.168.1.1/admin')).rejects.toThrow('endereços internos');
    await expect(assertPublicHttpsUrl('http://8.8.8.8')).rejects.toThrow('HTTPS');
  });
});

describe('testIntegrationRequest',()=>{
  it('substitui variáveis e devolve status, headers e JSON',async()=>{
    let request:{url?:string;init?:RequestInit}={};
    const fetchImpl=(async(url:string|URL|Request,init?:RequestInit)=>{request={url:String(url),init};return new Response('{"accepted":true}',{status:201,headers:{'x-request-id':'abc'}})}) as typeof fetch;
    const result=await testIntegrationRequest({config:{url:'https://8.8.8.8/{{pedido.id}}',method:'POST',headers:{authorization:'Bearer {{token}}'},body:'{"name":"{{contact.name}}"}'},variables:{pedido:{id:42},token:'secret',contact:{name:'Ana'}},fetchImpl});
    expect(request.url).toBe('https://8.8.8.8/42');
    expect(request.init).toMatchObject({method:'POST',headers:{authorization:'Bearer secret'},body:'{"name":"Ana"}',redirect:'manual'});
    expect(result).toMatchObject({ok:true,status:201,body:{accepted:true},headers:{'x-request-id':'abc'}});
  });

  it('remove headers controlados pelo transporte',async()=>{
    let headers:HeadersInit|undefined;
    const fetchImpl=(async(_url:string|URL|Request,init?:RequestInit)=>{headers=init?.headers;return new Response('ok',{status:200})}) as typeof fetch;
    await testIntegrationRequest({config:{url:'https://8.8.8.8',method:'GET',headers:{host:'internal','x-safe':'yes'}},variables:{},fetchImpl});
    expect(headers).toEqual({'x-safe':'yes'});
  });
});

describe('endurecimento da rota de teste',()=>{
  it('codifica variáveis na URL mas não em headers e corpo',async()=>{
    let seen:{url?:string;init?:RequestInit}={};
    const fetchImpl=(async(url:string|URL|Request,init?:RequestInit)=>{seen={url:String(url),init};return new Response('ok')}) as typeof fetch;
    await testIntegrationRequest({config:{url:'https://8.8.8.8/{{q}}',method:'POST',headers:{'x-q':'{{q}}'},body:'{{q}}'},variables:{q:'a b/c'},fetchImpl});
    expect(seen.url).toBe('https://8.8.8.8/a%20b%2Fc');
    expect(seen.init).toMatchObject({headers:{'x-q':'a b/c'},body:'a b/c'});
  });

  it('URL bloqueada vira IntegrationUrlBlockedError',async()=>{
    await expect(testIntegrationRequest({config:{url:'https://localhost/x',method:'GET',headers:{}},variables:{}})).rejects.toBeInstanceOf(IntegrationUrlBlockedError);
  });

  it('cancela o stream quando a resposta passa de 100 KB',async()=>{
    let cancelled=false;
    const stream=new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array(60_000))},cancel(){cancelled=true}});
    const fetchImpl=(async()=>new Response(stream)) as typeof fetch;
    await expect(testIntegrationRequest({config:{url:'https://8.8.8.8',method:'GET',headers:{}},variables:{},fetchImpl})).rejects.toThrow('100 KB');
    expect(cancelled).toBe(true);
  });
});

describe('integrationTestRateLimit',()=>{
  it('permite 10 por minuto por usuário e bloqueia a 11ª com 429',async()=>{
    let n=0;const keys:string[]=[];
    const redis={eval:async(_s:string,_k:number,key:string)=>{keys.push(key);return ++n}};
    for(let i=0;i<10;i++)await integrationTestRateLimit(redis,'u1');
    await expect(integrationTestRateLimit(redis,'u1')).rejects.toMatchObject({code:'RATE_LIMITED',status:429});
    expect(keys[0]).toContain('u1');
  });
});
