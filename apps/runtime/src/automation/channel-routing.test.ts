import {describe,expect,it} from 'vitest';
import {normalizeInboundText,selectInboundRoute} from './channel-routing.js';

const keyword=(id:string,keyword:string,match:'EXACT'|'CONTAINS',playbookId:string)=>({id,keyword,normalizedKeyword:normalizeInboundText(keyword),match,playbookId});
describe('channel inbound routing',()=>{
  it('normalizes case and repeated spaces',()=>expect(normalizeInboundText('  Olá   COMPROVANTE  ')).toBe('olá comprovante'));
  it('prioritizes exact keyword over contains and welcome',()=>expect(selectInboundRoute({body:'  Comprovante ',keywords:[keyword('c','provante','CONTAINS','contains'),keyword('e','comprovante','EXACT','exact')],welcomePlaybookId:'welcome',firstMessage:true,hasRecentExecution:false})).toEqual({playbookId:'exact',reason:'keyword',keywordId:'e'}));
  it('uses the longest contains match',()=>expect(selectInboundRoute({body:'enviar comprovante agora',keywords:[keyword('a','compro','CONTAINS','a'),keyword('b','comprovante','CONTAINS','b')],firstMessage:false,hasRecentExecution:false})).toEqual({playbookId:'b',reason:'keyword',keywordId:'b'}));
  it('uses welcome only on the first message',()=>expect(selectInboundRoute({body:'oi',keywords:[],welcomePlaybookId:'welcome',defaultPlaybookId:'default',firstMessage:true,hasRecentExecution:false})).toEqual({playbookId:'welcome',reason:'welcome'}));
  it('uses default only outside the recent execution window',()=>{
    expect(selectInboundRoute({body:'oi',keywords:[],defaultPlaybookId:'default',firstMessage:false,hasRecentExecution:false})).toEqual({playbookId:'default',reason:'default'});
    expect(selectInboundRoute({body:'oi',keywords:[],defaultPlaybookId:'default',firstMessage:false,hasRecentExecution:true})).toBeNull();
  });
});
