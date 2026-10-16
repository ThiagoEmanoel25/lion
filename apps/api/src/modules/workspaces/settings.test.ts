import {describe,expect,it} from 'vitest';
import {createInviteToken,defaultBusinessHours,hashInviteToken,keyLast4,readBusinessHours} from './settings.js';

describe('workspace settings helpers',()=>{
  it('gera tokens aleatórios e armazena apenas um hash estável',()=>{const first=createInviteToken();const second=createInviteToken();expect(first.token).not.toBe(second.token);expect(first.hash).toBe(hashInviteToken(first.token));expect(first.hash).not.toContain(first.token)});
  it('fornece sete dias úteis padrão no timezone do workspace',()=>{const hours=readBusinessHours({},'America/Sao_Paulo') as typeof defaultBusinessHours;expect(hours.days).toHaveLength(7);expect(hours.days.filter(day=>day.enabled).map(day=>day.day)).toEqual([1,2,3,4,5]);expect(hours.timezone).toBe('America/Sao_Paulo')});
  it('preserva configuração existente',()=>{const existing={timezone:'UTC',days:[],outsideMessage:'Fechado'};expect(readBusinessHours({businessHours:existing},'x')).toBe(existing)})
});

describe('keyLast4',()=>{
  it('mostra só os 4 últimos caracteres',()=>{expect(keyLast4('sk-proj-abcdefghijklmnop1234')).toBe('1234')})
});
