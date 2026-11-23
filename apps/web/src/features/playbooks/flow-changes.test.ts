import {describe,expect,it} from 'vitest';
import {edgeChangesDirty,nodeChangesDirty} from './flow-changes';

describe('nodeChangesDirty',()=>{
  it('ignora dimensions e select emitidos ao montar',()=>{
    expect(nodeChangesDirty([{type:'dimensions'},{type:'select'}])).toBe(false);
    expect(nodeChangesDirty([])).toBe(false);
  });
  it('não suja durante o arraste, só ao soltar',()=>{
    expect(nodeChangesDirty([{type:'position',dragging:true,position:{x:1,y:1}}])).toBe(false);
    expect(nodeChangesDirty([{type:'position',dragging:false,position:{x:1,y:1}}])).toBe(true);
    expect(nodeChangesDirty([{type:'position',dragging:false}])).toBe(false);
  });
  it('add, remove e replace sujam',()=>{
    for(const type of ['add','remove','replace'] as const)expect(nodeChangesDirty([{type}])).toBe(true);
  });
});
describe('edgeChangesDirty',()=>{
  it('select não suja; add/remove/replace sim',()=>{
    expect(edgeChangesDirty([{type:'select'}])).toBe(false);
    for(const type of ['add','remove','replace'] as const)expect(edgeChangesDirty([{type}])).toBe(true);
  });
});
