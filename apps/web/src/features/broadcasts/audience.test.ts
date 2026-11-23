import {describe,expect,it} from 'vitest';
import {buildAudiencePayload,canCreateBroadcast,progressPercent,progressSummary} from './audience';

const empty={tagIds:[],stages:[],contactIds:[]};
const base={name:'A',channelId:'c',body:'oi',audience:empty,allContacts:false,confirmedAll:false,eligible:5,pending:false};
describe('payload de público',()=>{
  it('sem filtro e sem confirmação não envia allContacts',()=>expect(buildAudiencePayload(empty,false)).not.toHaveProperty('allContacts'));
  it('base inteira confirmada envia allContacts:true',()=>expect(buildAudiencePayload(empty,true).allContacts).toBe(true));
  it('com filtro nunca envia allContacts',()=>expect(buildAudiencePayload({...empty,tagIds:['t']},true)).not.toHaveProperty('allContacts'));
});
describe('liberação do botão',()=>{
  it('bloqueia sem público definido',()=>expect(canCreateBroadcast(base)).toBe(false));
  it('bloqueia base inteira sem confirmação',()=>expect(canCreateBroadcast({...base,allContacts:true})).toBe(false));
  it('libera base inteira confirmada com elegíveis',()=>expect(canCreateBroadcast({...base,allContacts:true,confirmedAll:true})).toBe(true));
  it('libera com filtro',()=>expect(canCreateBroadcast({...base,audience:{...empty,stages:['lead']}})).toBe(true));
  it('bloqueia sem elegíveis',()=>expect(canCreateBroadcast({...base,allContacts:true,confirmedAll:true,eligible:0})).toBe(false));
});
describe('progresso',()=>{
  const progress={total:10,sent:5,skipped:2,pending:1,failed:1,cancelled:1};
  it('resume com ignorados',()=>expect(progressSummary(progress)).toBe('5 de 10 enviados · 2 ignorados · 1 falhou · 1 cancelado'));
  it('soma das partes bate com o total',()=>expect(progress.sent+progress.skipped+progress.pending+progress.failed+progress.cancelled).toBe(progress.total));
  it('percentual',()=>expect(progressPercent(progress)).toBe(90));
});
