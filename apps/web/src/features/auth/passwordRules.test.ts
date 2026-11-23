import {describe,expect,it} from 'vitest';
import {fieldErrorsOf,roleLabel,translateChangePasswordError,translateInviteError,translateResetError,validateConfirmation,validateName,validateNewPassword} from './passwordRules';

describe('validação de senha',()=>{
  it('exige 12 a 128 caracteres',()=>{
    expect(validateNewPassword('')).toBe('Informe a senha.');
    expect(validateNewPassword('a'.repeat(11))).toContain('mínimo 12');
    expect(validateNewPassword('a'.repeat(12))).toBeUndefined();
    expect(validateNewPassword('a'.repeat(129))).toContain('máximo 128');
  });
  it('confirmação precisa ser igual',()=>{
    expect(validateConfirmation('abc','')).toBe('Confirme a senha.');
    expect(validateConfirmation('abc','abd')).toBe('As senhas não conferem.');
    expect(validateConfirmation('abc','abc')).toBeUndefined();
  });
  it('valida o nome (2 a 100)',()=>{expect(validateName(' a ')).toBeTruthy();expect(validateName('Ana')).toBeUndefined();expect(validateName('a'.repeat(101))).toBeTruthy()});
});
describe('papéis',()=>{
  it('traduz os papéis do contrato e mantém desconhecidos',()=>{
    expect(['OWNER','ADMIN','SUPERVISOR','AGENT','VIEWER'].map(roleLabel)).toEqual(['Responsável pela conta','Administrador','Supervisor','Atendente','Leitor']);
    expect(roleLabel('X')).toBe('X');
  });
});
describe('tradução de erros',()=>{
  it('convite',()=>{
    expect(translateInviteError({status:404,code:'INVALID_INVITE'}).kind).toBe('invalid');
    expect(translateInviteError({status:410,code:'INVITE_EXPIRED'}).kind).toBe('invalid');
    expect(translateInviteError({status:409,code:'USER_EXISTS'}).message).toBe('Este e-mail já tem uma conta. Entre com seu e-mail e senha.');
    expect(translateInviteError({status:429}).message).toBe('Muitas tentativas. Aguarde alguns minutos e tente de novo.');
    expect(translateInviteError({status:422,details:{fieldErrors:{password:['Muito curta']}}}).fields).toEqual({password:'Muito curta'});
    expect(translateInviteError(new Error('x')).kind).toBe('generic');
  });
  it('redefinição',()=>{
    expect(translateResetError({status:400,code:'RESET_TOKEN_INVALID'}).message).toContain('administrador da sua conta');
    expect(translateResetError({status:429}).kind).toBe('rate');
    expect(translateResetError({status:422,details:{fieldErrors:{token:['curto']}}}).kind).toBe('invalid');
    expect(translateInviteError({status:422,details:{fieldErrors:{token:['curto']}}}).kind).toBe('invalid');
  });
  it('troca de senha',()=>{
    expect(translateChangePasswordError({status:401,code:'INVALID_CREDENTIALS'}).fields?.currentPassword).toBe('A senha atual está incorreta.');
    expect(translateChangePasswordError({status:422,code:'PASSWORD_UNCHANGED'}).fields?.newPassword).toBe('A nova senha precisa ser diferente da atual.');
    expect(translateChangePasswordError({status:429}).message).toBe('Muitas tentativas. Aguarde alguns minutos.');
  });
  it('fieldErrorsOf ignora formatos inesperados',()=>{expect(fieldErrorsOf(undefined)).toEqual({});expect(fieldErrorsOf({fieldErrors:{a:[],b:'x'}})).toEqual({b:'x'})});
});
