import {describe,expect,it} from 'vitest';
import {auditActionLabel,label,plural,timeZoneList,INVITE_STATUS_LABELS,PLAN_LABELS,SUBSCRIPTION_STATUS_LABELS} from './labels';
import {describeApiError,describeFieldErrors,translateIssue} from './errors';
import {ApiError} from '../../shared/api/client';

describe('rótulos pt-BR',()=>{
  it('plural de cartões',()=>{expect(plural(0,'cartão','cartões')).toBe('0 cartões');expect(plural(1,'cartão','cartões')).toBe('1 cartão');expect(plural(2,'cartão','cartões')).toBe('2 cartões')});
  it('mapeia status e plano com fallback ao valor original',()=>{
    expect(label(INVITE_STATUS_LABELS,'PENDING')).toBe('Pendente');
    expect(label(SUBSCRIPTION_STATUS_LABELS,'active')).toBe('Ativa');
    expect(label(PLAN_LABELS,'growth')).toBe('Growth');
    expect(label(PLAN_LABELS,'unlimited')).toBe('Ilimitado');
    expect(label(PLAN_LABELS,'plano_novo')).toBe('plano_novo');
  });
  it('auditoria vira frase e mantém código desconhecido',()=>{
    expect(auditActionLabel('whatsapp.session_created')).toBe('Sessão de WhatsApp criada');
    expect(auditActionLabel('algo.novo')).toBe('algo.novo');
  });
  it('lista de fusos inclui o atual e UTC',()=>{const zones=timeZoneList('Mars/Base');expect(zones[0]).toBe('Mars/Base');expect(zones).toContain('America/Sao_Paulo');expect(zones).toContain('UTC')});
});

describe('erros da API em pt-BR',()=>{
  it('USER_EXISTS explica que o e-mail pertence a uma única conta',()=>expect(describeApiError(new ApiError(409,'USER_EXISTS','x'),'f')).toMatch(/única conta/));
  it('INVALID_TIMEZONE',()=>expect(describeApiError(new ApiError(422,'INVALID_TIMEZONE','x'),'f')).toMatch(/Fuso horário inválido/));
  it('usa fieldErrors traduzidos',()=>{
    const error=new ApiError(422,'VALIDATION_ERROR','x',{fieldErrors:{email:['Invalid email address'],name:['Too small: expected string to have >=2 characters'],days:['O horário de abertura deve ser anterior ao fechamento.']}});
    const text=describeApiError(error,'f');
    expect(text).toContain('E-mail: e-mail inválido');expect(text).toContain('Nome: use ao menos 2 caracteres');expect(text).toContain('abertura deve ser anterior');
  });
  it('erro desconhecido usa o texto de reserva',()=>expect(describeApiError(new Error('boom'),'Não foi possível salvar.')).toBe('Não foi possível salvar.'));
  it('traduz mensagens padrão do zod',()=>{expect(translateIssue('Invalid input')).toBe('valor inválido');expect(describeFieldErrors(undefined)).toBe('')});
});
