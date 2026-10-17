import {describe,expect,it} from 'vitest';
import {pixelReferenceIssues} from './validation.js';
import type {AutomationDefinition} from '../playbooks/compiler.js';

const pixelId='clx000000000000000000001';
const definition={start:'start',nodes:[{id:'start',kind:'trigger',name:'Início',config:{},position:{x:0,y:0}},{id:'px',kind:'pixel',name:'Pixel',config:{pixelId,eventName:'ViewContent'},position:{x:1,y:0}}],edges:[],settings:{maxSteps:10,timeoutSeconds:60}} as unknown as AutomationDefinition;

describe('validação das referências de Pixel',()=>{
  it('aceita pixel do workspace',async()=>{const prisma={metaPixel:{findMany:async()=>[{id:pixelId}]}};expect(await pixelReferenceIssues(prisma,'w',definition)).toEqual([])});
  it('aponta pixel inexistente',async()=>{const prisma={metaPixel:{findMany:async()=>[]}};const [issue]=await pixelReferenceIssues(prisma,'w',definition);expect(issue?.code).toBe('PIXEL_NOT_FOUND');expect(issue?.nodeId).toBe('px')});
  it('ignora definição sem pixel',async()=>{expect(await pixelReferenceIssues({},'w',{...definition,nodes:[definition.nodes[0]!]})).toEqual([])});
});
