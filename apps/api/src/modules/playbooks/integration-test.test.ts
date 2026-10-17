import {describe,expect,it} from 'vitest';
import {assertPublicHttpsUrl,isPrivateAddress} from '@nexo/domain';
import {testIntegrationRequest} from './integration-test.js';

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
