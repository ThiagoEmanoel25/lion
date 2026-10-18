import { describe, expect, it } from 'vitest';
import { aiLastMessage, joinReplies, pendingWaitOf,waitReplyActions, waitBufferSeconds, waitTimeoutSeconds } from './wait-response.js';

describe('wait-response', () => {
  it('converte tempo + unidade e respeita 31 dias', () => {
    expect(waitTimeoutSeconds({ timeoutValue: 2, timeoutUnit: 'hours' })).toEqual({ seconds: 7_200, endsWithoutTimeoutRoute: false });
    expect(waitTimeoutSeconds({ timeoutValue: 90, timeoutUnit: 'days' }).seconds).toBe(2_678_400);
  });
  it('esperar indefinidamente usa o limite técnico e termina sem erro', () => {
    expect(waitTimeoutSeconds({ waitIndefinitely: true, timeoutValue: 1, timeoutUnit: 'minutes' })).toEqual({ seconds: 2_678_400, endsWithoutTimeoutRoute: true });
  });
  it('buffer fora da faixa vira desligado', () => {
    expect(waitBufferSeconds({ bufferSeconds: 30 })).toBe(30);
    expect(waitBufferSeconds({ bufferSeconds: 999 })).toBe(0);
    expect(waitBufferSeconds({})).toBe(0);
  });
  it('junta as mensagens do buffer e usa o tipo da última', () => {
    expect(joinReplies([{ body: 'oi', type: 'TEXT' }, { body: 'segue o comprovante', type: 'TEXT' }, { body: null, type: 'IMAGE' }]))
      .toEqual({ last_message: 'oi\nsegue o comprovante', last_message_type: 'IMAGE' });
  });
  it('monta gravação persistente, reação e próximas mensagens citadas',()=>{
    expect(waitReplyActions({saveReplyTo:'resposta-lead',saveEmpty:false,reactEmoji:'✅',replyToLeadCount:2},{last_message:'aceito'},{id:'message-id',externalId:'wa-id'})).toEqual({saveReply:{field:'resposta-lead',value:'aceito'},quoteNext:{messageId:'message-id',remaining:2},reaction:{emoji:'✅',messageExternalId:'wa-id'}});
    expect(waitReplyActions({saveReplyTo:'resposta-lead',saveEmpty:false,replyToLeadCount:0},{last_message:''},{id:'media-id',externalId:null})).toEqual({});
  });
  it('lê a espera nova e a do Menu antigo', () => {
    expect(pendingWaitOf({ pendingWait: { stepId: 's', nodeId: 'n', kind: 'reply', since: '2026-10-15T00:00:00.000Z' } })?.kind).toBe('reply');
    expect(pendingWaitOf({ pendingMenu: { stepId: 's', nodeId: 'n' } })).toEqual({ stepId: 's', nodeId: 'n', kind: 'menu' });
    expect(pendingWaitOf({})).toBeUndefined();
  });
  it('IA mantém a resposta juntada pelo buffer e usa a última mensagem fora dele', () => {
    const context = { last_message: 'oi\nsegue o comprovante', wait: { messageIds: ['m1', 'm2', 'm3'] } };
    expect(aiLastMessage(context, { id: 'm3', body: null })).toBe('oi\nsegue o comprovante');
    expect(aiLastMessage(context, { id: 'm4', body: 'outra' })).toBe('outra');
    expect(aiLastMessage({ last_message: 'velha' }, { id: 'm1', body: 'nova' })).toBe('nova');
    expect(aiLastMessage(context, null)).toBe('');
  });
});
