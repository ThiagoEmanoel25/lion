import {describe,expect,it} from 'vitest';
import {normalizePhone,parseContactsCsv} from './csv.js';

describe('parseContactsCsv',()=>{
  it('aceita aliases em português, campos personalizados e valores entre aspas',()=>{const result=parseContactsCsv('Nome,Telefone,E-mail,Tags,Cidade\n"Maria, Silva",+55 (71) 99999-0000,maria@example.com,"vip; retorno",Salvador');expect(result.errors).toEqual([]);expect(result.rows[0]).toMatchObject({name:'Maria, Silva',phone:'+5571999990000',tags:['vip','retorno'],customFields:{Cidade:'Salvador'}})});
  it('relata linha e ignora registros inválidos',()=>{const result=parseContactsCsv('nome,telefone,email\nInválido,123,x@');expect(result.rows).toEqual([]);expect(result.errors).toEqual([{row:2,message:'Telefone inválido.'}])});
  it('exige a coluna de telefone',()=>{expect(parseContactsCsv('nome,email\nAna,a@b.com').errors[0]?.message).toContain('telefone')});
});

describe('normalizePhone',()=>{it('preserva o prefixo internacional',()=>expect(normalizePhone('+55 (11) 98888-7777')).toBe('+5511988887777'))});
