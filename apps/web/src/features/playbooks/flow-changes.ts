import type {EdgeChange,NodeChange} from '@xyflow/react';

/**
 * O React Flow emite `dimensions` e `select` ao montar e a cada clique; isso não altera o fluxo.
 * Só mudanças reais sujam o rascunho: add, remove, replace e posição com arraste concluído.
 */
export function nodeChangesDirty(changes:ReadonlyArray<Pick<NodeChange,'type'>&{dragging?:boolean;position?:unknown}>):boolean{
  return changes.some(change=>{
    if(change.type==='add'||change.type==='remove'||change.type==='replace')return true;
    if(change.type==='position')return change.dragging===false&&change.position!==undefined;
    return false;
  });
}
export function edgeChangesDirty(changes:ReadonlyArray<Pick<EdgeChange,'type'>>):boolean{
  return changes.some(change=>change.type==='add'||change.type==='remove'||change.type==='replace');
}
