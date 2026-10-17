import { describe, expect, it } from 'vitest';
import { AutomationNodeKindSchema, AutomationPixelConfigSchema, MetaPixelInput, PIXEL_EVENTS } from './index.js';

const pixelId = 'clx000000000000000000001';

describe('AutomationPixelConfigSchema', () => {
  it('exige valor em Purchase', () => {
    expect(AutomationPixelConfigSchema.safeParse({ pixelId, eventName: 'Purchase' }).success).toBe(false);
    expect(AutomationPixelConfigSchema.safeParse({ pixelId, eventName: 'Purchase', value: '{{valor}}' }).success).toBe(true);
  });
  it('valor é opcional nos outros eventos e moeda padrão é BRL', () => {
    const r = AutomationPixelConfigSchema.parse({ pixelId, eventName: 'LeadSubmitted' });
    expect(r.currency).toBe('BRL');
  });
  it('valida moeda, evento e pixelId', () => {
    expect(AutomationPixelConfigSchema.safeParse({ pixelId, eventName: 'Lead', value: '1' }).success).toBe(false);
    expect(AutomationPixelConfigSchema.safeParse({ pixelId, eventName: 'AddToCart', currency: 'brl' }).success).toBe(false);
    expect(AutomationPixelConfigSchema.safeParse({ pixelId: 'x', eventName: 'AddToCart' }).success).toBe(false);
  });
  it('kind e tabela de eventos', () => {
    expect(AutomationNodeKindSchema.safeParse('pixel').success).toBe(true);
    expect(PIXEL_EVENTS.map(e => e.eventName)).toEqual(['Purchase', 'LeadSubmitted', 'QualifiedLead', 'InitiateCheckout', 'AddToCart', 'ViewContent']);
  });
});

describe('MetaPixelInput', () => {
  it('aceita pixel completo', () => {
    expect(MetaPixelInput.safeParse({ name: 'P', pixelId: '123456', accessToken: 'EAAB1234567890' }).success).toBe(true);
    expect(MetaPixelInput.safeParse({ name: 'P', pixelId: 'abc', accessToken: 'EAAB1234567890' }).success).toBe(false);
  });
});
