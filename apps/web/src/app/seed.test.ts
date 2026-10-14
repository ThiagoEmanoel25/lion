import {describe,it,expect} from 'vitest';import {demoConversations,demoMessages} from './seed';
describe('dados de demonstração',()=>{it('mantém referências mínimas para modo offline',()=>{expect(demoConversations.length).toBeGreaterThan(0);expect(demoMessages.every(message=>message.body.length>0)).toBe(true)})});
