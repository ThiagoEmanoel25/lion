import {describe,expect,it} from 'vitest';
import {buildConversationQuery} from './queries';

describe('inbox query',()=>{
  it('serializa filtros e cursor sem perder caracteres da busca',()=>{
    const query=new URLSearchParams(buildConversationQuery({search:'João +55',status:'QUEUED',mode:'HUMAN'},'cursor-1'));
    expect(Object.fromEntries(query)).toEqual({search:'João +55',status:'QUEUED',mode:'HUMAN',cursor:'cursor-1',limit:'30'});
  });

  it('omite filtros vazios',()=>{
    expect(buildConversationQuery({search:'',status:'',mode:''},null)).toBe('limit=30');
  });
});
