import {describe,expect,it} from 'vitest';
import {quickReplyKey,replaceShortcut,shortcutToken} from './quick-replies';

describe('atalho de resposta rápida',()=>{
  it('abre no início ou depois de espaço, sem diferenciar caixa',()=>{
    expect(shortcutToken('/PIX')).toEqual({start:0,end:4,search:'pix'});
    expect(shortcutToken('Olá /PiX')).toEqual({start:4,end:8,search:'pix'});
    expect(shortcutToken('Olá/pix')).toBeNull();
  });

  it('considera o cursor e preserva o texto posterior ao substituir',()=>{
    const text='Antes /pix depois';const token=shortcutToken(text,10);
    expect(token).toEqual({start:6,end:10,search:'pix'});
    expect(replaceShortcut(text,token!,'chave copiada')).toBe('Antes chave copiada depois');
  });
  it('navega circularmente, insere com Enter e fecha com Escape',()=>{
    expect(quickReplyKey('ArrowDown',1,3)).toEqual({action:'move',index:2});expect(quickReplyKey('ArrowDown',2,3).index).toBe(0);expect(quickReplyKey('ArrowUp',0,3).index).toBe(2);expect(quickReplyKey('Enter',1,3).action).toBe('insert');expect(quickReplyKey('Escape',1,3).action).toBe('close');
  });
});
