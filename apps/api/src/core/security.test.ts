import {describe,it,expect} from 'vitest';import {can} from '@nexo/domain';
describe('RBAC',()=>{it('impede agente de gerenciar workspace',()=>expect(can('AGENT','workspace.manage')).toBe(false));it('permite supervisor publicar playbook',()=>expect(can('SUPERVISOR','playbook.publish')).toBe(true));it('permite owner executar qualquer ação',()=>expect(can('OWNER','billing.manage')).toBe(true))});
