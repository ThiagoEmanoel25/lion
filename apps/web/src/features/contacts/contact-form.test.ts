import {describe,expect,it} from 'vitest';
import {buildContactPayload,consentChange,fieldErrorsFrom,formFromContact,importErrorLine,importSummary,normalizeImportReport,pairsToCustomFields,customFieldsToPairs,validateContactForm} from './contact-form';
import {formatPhone,sourceLabel,stageLabel} from './labels';
import {consentStatus} from './consent-view';
import {scheduledStatusLabel,scheduleError} from '../inbox/labels';

describe('buildContactPayload',()=>{
  it('omite campos vazios na criação (nunca null)',()=>{const form={...formFromContact(null),name:'Ana',phone:' +5571999990000 '};const payload=buildContactPayload(form,null);expect(payload).toEqual({phone:'+5571999990000',name:'Ana',stage:'new',tagIds:[],customFields:{}});expect(JSON.stringify(payload)).not.toContain('null')});
  it('na edição só envia null para o que foi esvaziado',()=>{const initial={name:'Ana',phone:'+5571999990000',email:'a@a.com',source:null,stage:'new',owner:{id:'o1'},tags:[],customFields:{}};const form={...formFromContact(initial),email:'',ownerId:''};const payload=buildContactPayload(form,initial);expect(payload.email).toBeNull();expect(payload.ownerId).toBeNull();expect('source' in payload).toBe(false)});
  it('inclui consentimento só quando muda',()=>{const form={...formFromContact(null),phone:'+5571999990000',consentGiven:true};expect(buildContactPayload(form,null).consent).toEqual({given:true,source:'manual'});expect(buildContactPayload({...form,consentGiven:false},null).consent).toBeUndefined()});
});
describe('consentChange',()=>{
  const optedOut={given:false,at:null,source:null,revokedAt:null,optedOut:true,eligible:false};
  it('opt-out exige reconsent explícito',()=>{expect(consentChange({consentGiven:true,consentSource:'manual',reconsent:false},optedOut)).toBeUndefined();expect(consentChange({consentGiven:true,consentSource:'whatsapp',reconsent:true},optedOut)).toEqual({given:true,source:'whatsapp',reconsent:true})});
  it('revoga quem já deu consentimento',()=>{expect(consentChange({consentGiven:false,consentSource:'manual',reconsent:false},{given:true,at:'2026-01-01',source:'csv',revokedAt:null,optedOut:false,eligible:true})).toEqual({given:false,source:'manual'})});
});
describe('campos personalizados',()=>{
  it('round-trip preserva tipos não editados',()=>{const pairs=customFieldsToPairs({idade:30,cidade:'Salvador',extra:{a:1}});expect(pairsToCustomFields(pairs)).toEqual({idade:30,cidade:'Salvador',extra:{a:1}})});
  it('edição vira texto, chaves vazias somem',()=>{const pairs=customFieldsToPairs({idade:30});pairs[0]!.value='31';pairs.push({key:' ',value:'x'},{key:'plano',value:'pro'});expect(pairsToCustomFields(pairs)).toEqual({idade:'31',plano:'pro'})});
});
describe('erros da API',()=>{
  it('traduz fieldErrors do zod para pt-BR',()=>{const errors=fieldErrorsFrom({formErrors:[],fieldErrors:{phone:['Too small: expected string to have >=8 characters'],email:['Invalid email address'],stage:['Invalid input: expected string, received number']}});expect(errors.phone).toMatch(/pelo menos 8/);expect(errors.email).toMatch(/e-mail válido/);expect(errors.stage).toBe('Valor inválido.')});
  it('ignora formato desconhecido',()=>{expect(fieldErrorsFrom(undefined)).toEqual({});expect(fieldErrorsFrom({fieldErrors:{name:'x'}})).toEqual({})});
  it('validação local',()=>{expect(validateContactForm({...formFromContact(null),phone:''}).phone).toBeTruthy();expect(validateContactForm({...formFromContact(null),phone:'+5571999990000',email:'x'}).email).toBeTruthy();expect(validateContactForm({...formFromContact(null),phone:'+5571999990000'})).toEqual({})});
});
describe('relatório de importação',()=>{
  it('normaliza e resume',()=>{const report=normalizeImportReport({total:3,created:1,updated:0,failed:2,consentRecorded:1,consentSkippedOptedOut:0,errors:[{row:2,message:'Telefone inválido.'},{row:1,message:'Cabeçalho obrigatório ausente: telefone.'}]})!;expect(importSummary(report)).toBe('1 criado · 0 atualizados · 2 com erro');expect(importErrorLine(report.errors[0]!)).toBe('Linha 2: Telefone inválido.');expect(importErrorLine(report.errors[1]!)).toBe('Cabeçalho (linha 1): Cabeçalho obrigatório ausente: telefone.')});
  it('rejeita corpo que não é relatório',()=>{expect(normalizeImportReport({code:'X',message:'y'})).toBeNull();expect(normalizeImportReport(null)).toBeNull()});
});
describe('rótulos',()=>{
  it('traduz com fallback ao valor original',()=>{expect(stageLabel('qualification')).toBe('Em qualificação');expect(stageLabel('custom_stage')).toBe('custom_stage');expect(sourceLabel('instagram')).toBe('Instagram');expect(sourceLabel('Parceiro X')).toBe('Parceiro X');expect(scheduledStatusLabel('PENDING')).toBe('Pendente');expect(scheduledStatusLabel('OTHER')).toBe('OTHER')});
  it('telefone sempre com +',()=>{expect(formatPhone('5571999999999')).toBe('+5571999999999');expect(formatPhone('+5571999999999')).toBe('+5571999999999');expect(formatPhone('')).toBe('')});
  it('estado do consentimento',()=>{expect(consentStatus({given:true,at:'2026-03-05T12:00:00Z',source:'manual',revokedAt:null,optedOut:false,eligible:true}).text).toBe('Consentimento dado em 05/03/2026 · origem: manual');expect(consentStatus({given:false,at:null,source:null,revokedAt:null,optedOut:true,eligible:false}).text).toBe('Pediu para sair')});
  it('valida agendamento',()=>{const now=new Date('2026-01-01T10:00:00');expect(scheduleError('',now)).toBeTruthy();expect(scheduleError('2026-01-01T09:00',now)).toMatch(/futuro/);expect(scheduleError('2026-01-02T09:00',now)).toBeNull()});
});
