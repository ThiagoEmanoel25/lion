import {describe,expect,it} from 'vitest';import {chunkText} from './knowledge-indexer.service.js';describe('knowledge chunking',()=>{it('preserva parágrafos e respeita o tamanho máximo',()=>{const result=chunkText('Primeiro parágrafo.\n\nSegundo parágrafo mais longo.',25);expect(result.every(chunk=>chunk.length<=25)).toBe(true);expect(result.join(' ')).toContain('Primeiro parágrafo.')});it('ignora conteúdo vazio',()=>expect(chunkText('  \n\n ')).toEqual([]))});

import {unindexableReason} from './knowledge-indexer.service.js';
describe('unindexableReason',()=>{it('aceita texto e arquivos de texto; recusa url, PDF/Office, binário e vazio',()=>{
  expect(unindexableReason({kind:'text',name:'x'},'conteúdo')).toBeNull();
  for(const name of ['a.txt','B.MD','c.csv','d.json'])expect(unindexableReason({kind:'file',name},'conteúdo')).toBeNull();
  expect(unindexableReason({kind:'file',name:'a.pdf'},'conteúdo')).toMatch(/texto/);
  expect(unindexableReason({kind:'file',name:'a.docx'},'conteúdo')).not.toBeNull();
  expect(unindexableReason({kind:'file',name:'a.txt'},'a\u0000b')).toMatch(/UTF-8/);
  expect(unindexableReason({kind:'url',name:'s'},'x')).toMatch(/URL/);
  expect(unindexableReason({kind:'text',name:'s'},'  ')).not.toBeNull();
})});
