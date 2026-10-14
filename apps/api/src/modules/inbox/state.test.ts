import {describe,expect,it} from 'vitest';
import {modeTransition,statusTransition} from './state.js';

describe('conversation transitions',()=>{
  it('atribui a conversa ao operador no handoff humano',()=>{
    expect(modeTransition('HUMAN','user-1')).toEqual({mode:'HUMAN',assigneeId:'user-1',status:'ASSIGNED'});
  });

  it('remove o operador quando a conversa volta para a IA',()=>{
    expect(modeTransition('AI','user-1')).toEqual({mode:'AI',assigneeId:null,status:'AUTOMATED'});
  });

  it('encerra e reabre a conversa preservando a semântica de resolução',()=>{
    const now=new Date('2026-10-14T12:00:00Z');
    expect(statusTransition('RESOLVED',now)).toEqual({status:'RESOLVED',resolvedAt:now,unreadCount:0});
    expect(statusTransition('QUEUED',now)).toEqual({status:'QUEUED',resolvedAt:null,unreadCount:undefined});
  });
});
