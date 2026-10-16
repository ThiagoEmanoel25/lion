import {describe,expect,it} from 'vitest';
import {validateAutomation} from '../playbooks/compiler.js';

const trigger={id:'start',kind:'trigger' as const,name:'Início',config:{event:'message.received'},position:{x:0,y:0}};
const end={id:'end',kind:'outcome' as const,name:'Fim',config:{type:'RESOLVED'},position:{x:200,y:0}};
const definition=(config:Record<string,unknown>)=>({start:'start',nodes:[trigger,{id:'card',kind:'kanban' as const,name:'Kanban',config,position:{x:100,y:0}},end],edges:[{id:'a',source:'start',target:'card'},{id:'b',source:'card',target:'end'}],settings:{maxSteps:30,timeoutSeconds:300}});

describe('compiler do bloco Kanban',()=>{
  it('aceita a configuração completa',()=>expect(validateAutomation(definition({boardId:'clx000000000000000000001',columnId:'clx000000000000000000002',mode:'move_only'})).valid).toBe(true));
  it('recusa quadro e coluna ausentes',()=>{const result=validateAutomation(definition({mode:'create_or_move'}));expect(result.valid).toBe(false);expect(result.issues.some(issue=>issue.code==='INVALID_KANBAN_CONFIG')).toBe(true)});
});
