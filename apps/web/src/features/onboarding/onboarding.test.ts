import {beforeEach,describe,expect,it,vi} from 'vitest';
import {buildChecklist,summarize} from './progress';
import {onboardingKey,readOnboarding,writeOnboarding,clearOnboarding} from './state';

function fakeStorage(){const map=new Map<string,string>();return {getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)},removeItem:(k:string)=>{map.delete(k)},map}}
const done=(f:Parameters<typeof buildChecklist>[0])=>buildChecklist(f).filter(i=>i.done).map(i=>i.id);

describe('progresso do checklist',()=>{
  it('começa zerado sem dados',()=>{expect(summarize(buildChecklist({}))).toMatchObject({done:0,total:5,percent:0,complete:false})});
  it('marca cada item pelos dados reais',()=>{
    expect(done({channels:[{status:'PENDING'}]})).toEqual([]);
    expect(done({channels:[{status:'CONNECTED'}]})).toEqual(['channel']);
    expect(done({playbooks:[{status:'DRAFT'}]})).toEqual(['flow-created']);
    expect(done({playbooks:[{status:'PUBLISHED'}]})).toEqual(['flow-created','flow-published']);
    expect(done({playbooks:[{status:'PAUSED',activeVersion:{id:'v'}}]})).toEqual(['flow-created','flow-published']);
    expect(done({contactCount:1})).toEqual(['contact']);
  });
  it('IA exige agente ativo e chave configurada',()=>{
    expect(done({agents:[{isActive:true}],providers:[{name:'openai',configured:false}]})).toEqual([]);
    expect(done({agents:[{isActive:false}],providers:[{name:'openai',configured:true}]})).toEqual([]);
    expect(done({agents:[{isActive:true}],providers:[{name:'openai',configured:true}]})).toEqual(['ai']);
  });
  it('completo = 100%',()=>{
    const s=summarize(buildChecklist({channels:[{status:'CONNECTED'}],playbooks:[{status:'PUBLISHED'}],contactCount:3,agents:[{isActive:true}],providers:[{name:'openai',configured:true}]}));
    expect(s).toMatchObject({done:5,percent:100,complete:true});
  });
});

describe('persistência do onboarding',()=>{
  beforeEach(()=>{vi.stubGlobal('localStorage',fakeStorage())});
  it('usa a chave por workspace e usuário',()=>{expect(onboardingKey('w1','u1')).toBe('zuno.onboarding:w1:u1')});
  it('devolve o padrão quando vazio',()=>{expect(readOnboarding('w','u')).toEqual({version:1,welcomeSeen:false,dismissed:false})});
  it('grava e lê, isolando usuários',()=>{
    writeOnboarding('w','u1',{version:1,welcomeSeen:true,dismissed:true});
    expect(readOnboarding('w','u1')).toEqual({version:1,welcomeSeen:true,dismissed:true});
    expect(readOnboarding('w','u2').welcomeSeen).toBe(false);
    clearOnboarding('w','u1');expect(readOnboarding('w','u1').welcomeSeen).toBe(false);
  });
  it('ignora JSON corrompido e storage bloqueado',()=>{
    localStorage.setItem(onboardingKey('w','u'),'{ruim');expect(readOnboarding('w','u').welcomeSeen).toBe(false);
    vi.stubGlobal('localStorage',{getItem:()=>{throw new Error('x')},setItem:()=>{throw new Error('x')},removeItem:()=>{throw new Error('x')}});
    expect(readOnboarding('w','u').dismissed).toBe(false);
    expect(()=>writeOnboarding('w','u',{version:1,welcomeSeen:true,dismissed:false})).not.toThrow();
  });
});
