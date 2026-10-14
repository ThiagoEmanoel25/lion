import {describe,expect,it} from 'vitest';import {decryptWebhookSecret,encryptWebhookSecret,mappedVariables,readPath,validWebhookSignature,webhookSignature} from './generic.js';
const key=Buffer.alloc(32,7);
describe('generic inbound webhook security',()=>{
  it('cifra o segredo e autentica corpo e timestamp',()=>{const secret='whsec_test',encrypted=encryptWebhookSecret(secret,key),timestamp='1791979200',body=Buffer.from('{"lead":{"phone":"5571"}}');expect(encrypted).not.toContain(secret);expect(decryptWebhookSecret(encrypted,key)).toBe(secret);expect(validWebhookSignature(secret,timestamp,webhookSignature(secret,timestamp,body),body,1791979200)).toBe(true)});
  it('rejeita assinatura expirada ou corpo adulterado',()=>{const timestamp='1791979200',signature=webhookSignature('secret',timestamp,'{}');expect(validWebhookSignature('secret',timestamp,signature,'{"x":1}',1791979200)).toBe(false);expect(validWebhookSignature('secret',timestamp,signature,'{}',1791979501)).toBe(false)});
  it('mapeia somente caminhos próprios existentes',()=>{const payload={lead:{phone:'5571999'},score:8};expect(readPath(payload,'lead.phone')).toBe('5571999');expect(readPath(payload,'__proto__.x')).toBeUndefined();expect(mappedVariables(payload,{phone:'lead.phone',score:'score',missing:'x.y'})).toEqual({phone:'5571999',score:8})});
});
