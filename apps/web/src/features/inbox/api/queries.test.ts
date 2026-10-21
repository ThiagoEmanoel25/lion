import {describe,expect,it} from 'vitest';
import {buildConversationQuery} from './queries';

describe('inbox query',()=>{
  it('serializa filtros e cursor sem perder caracteres da busca',()=>{
    const query=new URLSearchParams(buildConversationQuery({search:'João +55',bucket:'waiting',attention:'unanswered',mode:'HUMAN',channelId:'channel-1'},'cursor-1'));
    expect(Object.fromEntries(query)).toEqual({search:'João +55',bucket:'waiting',attention:'unanswered',mode:'HUMAN',channelId:'channel-1',cursor:'cursor-1',limit:'30'});
  });

  it('mantém a fila e o filtro rápido como filtros explícitos',()=>{
    expect(buildConversationQuery({search:'',bucket:'attending',attention:'all',mode:''},null)).toBe('bucket=attending&attention=all&limit=30');
  });
});
