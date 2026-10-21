import {describe,expect,it} from 'vitest';
import {GlobalVariableInput,QuickReplyInput} from './routes.js';

describe('phase one operational settings',()=>{
  it('normaliza o atalho sem barra e sem diferenciar caixa',()=>{
    expect(QuickReplyInput.parse({shortcut:'/PIX_Cliente',body:' Copie sua chave '}).shortcut).toBe('pix_cliente');
  });

  it('recusa atalhos e nomes globais inseguros',()=>{
    expect(()=>QuickReplyInput.parse({shortcut:'pix cliente',body:'x'})).toThrow();
    expect(()=>GlobalVariableInput.parse({name:'1_token',value:'x'})).toThrow();
  });

  it('normaliza o nome global e preserva o valor',()=>{
    expect(GlobalVariableInput.parse({name:'Link_Grupo',value:'https://example.test',sensitive:false})).toEqual({name:'link_grupo',value:'https://example.test',sensitive:false});
  });
});
