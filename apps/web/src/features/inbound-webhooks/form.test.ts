import {describe,expect,it} from 'vitest';import {parseWebhookVariables} from './form';
describe('webhook variable mapping',()=>{
  it('aceita mapa de caminhos',()=>expect(parseWebhookVariables('{"leadScore":"lead.score"}')).toEqual({leadScore:'lead.score'}));
  it.each(['[]','null','{"score": 2}','{"":"lead.id"}'])('rejeita configuração inválida: %s',value=>expect(()=>parseWebhookVariables(value)).toThrow());
  it('JSON inválido diz a linha em pt-BR',()=>{
    expect(()=>parseWebhookVariables('{\n  "a": "b",\n  nome: "x"\n}')).toThrow(/inválido na linha 3/);
    expect(()=>parseWebhookVariables('{')).toThrow(/JSON das variáveis é inválido/);
  });
});
