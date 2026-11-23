import {describe,expect,it} from 'vitest';
import {ApiError} from '../../shared/api/client';
import {flowErrorMessage,unchangedVersion} from './flow-errors';

describe('flowErrorMessage',()=>{
  it('usa a mensagem da API e acrescenta fieldErrors',()=>{
    const error=new ApiError(422,'VALIDATION_ERROR','Os dados enviados são inválidos.',{formErrors:[],fieldErrors:{name:['Obrigatório']}});
    expect(flowErrorMessage(error)).toBe('Os dados enviados são inválidos. Nome: Obrigatório');
  });
  it('cai no texto padrão para erros desconhecidos',()=>{
    expect(flowErrorMessage(new Error('boom'))).toMatch(/Não foi possível/);
    expect(flowErrorMessage(new ApiError(500,'X','Falhou'))).toBe('Falhou');
  });
});
describe('unchangedVersion',()=>{
  it('reconhece 409 UNCHANGED_DEFINITION',()=>{
    expect(unchangedVersion(new ApiError(409,'UNCHANGED_DEFINITION','x',{currentVersion:3}))).toEqual({current:3});
    expect(unchangedVersion(new ApiError(409,'UNCHANGED_DEFINITION','x'))).toEqual({current:null});
    expect(unchangedVersion(new ApiError(409,'OTHER','x'))).toBeNull();
    expect(unchangedVersion(new Error('x'))).toBeNull();
  });
});
