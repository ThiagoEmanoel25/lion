import {describe,expect,it,beforeEach,vi} from 'vitest';
import {clearDraft,draftKey,readDraft,writeDraft,type LocalDraft} from './flow-draft';

const draft=():LocalDraft=>({version:3,at:1_700_000_000_000,definition:{start:'a',nodes:[{id:'a',kind:'message',name:'Oi',config:{},position:{x:0,y:0}}],edges:[],settings:{maxSteps:30,timeoutSeconds:300}} as LocalDraft['definition']});

function fakeStorage(){const map=new Map<string,string>();return {getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)},removeItem:(k:string)=>{map.delete(k)},map}}

describe('rascunho local do editor', () => {
  beforeEach(() => {vi.stubGlobal('localStorage',fakeStorage())});

  it('devolve o rascunho que foi gravado', () => {
    writeDraft('flow-1',draft());
    expect(readDraft('flow-1')).toEqual(draft());
  });

  it('não vaza rascunho entre fluxos', () => {
    writeDraft('flow-1',draft());
    expect(readDraft('flow-2')).toBeNull();
  });

  it('ignora conteúdo corrompido em vez de quebrar o editor', () => {
    localStorage.setItem(draftKey('flow-1'),'{isso não é json');
    expect(readDraft('flow-1')).toBeNull();
  });

  it('ignora um rascunho sem nós, que sobrescreveria o fluxo com nada', () => {
    localStorage.setItem(draftKey('flow-1'),JSON.stringify({version:3,at:1,definition:{}}));
    expect(readDraft('flow-1')).toBeNull();
  });

  it('descarta o rascunho', () => {
    writeDraft('flow-1',draft());
    clearDraft('flow-1');
    expect(readDraft('flow-1')).toBeNull();
  });

  it('não propaga erro quando localStorage está bloqueado', () => {
    vi.stubGlobal('localStorage',{getItem(){throw new Error('bloqueado')},setItem(){throw new Error('bloqueado')},removeItem(){throw new Error('bloqueado')}});
    expect(readDraft('flow-1')).toBeNull();
    expect(()=>writeDraft('flow-1',draft())).not.toThrow();
    expect(()=>clearDraft('flow-1')).not.toThrow();
  });
});
