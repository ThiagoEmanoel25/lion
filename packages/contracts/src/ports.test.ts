import { describe, expect, it } from 'vitest';
import { edgePort, nodePorts } from './ports.js';
import { AutomationAiConfigSchema, AutomationEdgeSchema, AutomationWebhookConfigSchema, SetAiKeyInput } from './index.js';

describe('ports', () => {
  it('declara portas só para integração e IA', () => {
    expect(nodePorts('webhook')).toEqual(['success', 'failure']);
    expect(nodePorts('ai')).toEqual(['success', 'failure']);
    expect(nodePorts('message')).toEqual([]);
  });

  it('conexão sem porta vale como sucesso', () => {
    expect(edgePort({})).toBe('success');
    expect(edgePort({ port: 'failure' })).toBe('failure');
  });

  it('valida a porta na conexão', () => {
    expect(AutomationEdgeSchema.safeParse({ id: 'e', source: 'a', target: 'b', port: 'failure' }).success).toBe(true);
    expect(AutomationEdgeSchema.safeParse({ id: 'e', source: 'a', target: 'b', port: 'erro' }).success).toBe(false);
  });
});

describe('AutomationAiConfigSchema', () => {
  it('aplica os padrões da Leona', () => {
    const parsed = AutomationAiConfigSchema.parse({ systemPrompt: 'Analise o comprovante.' });
    expect(parsed).toEqual({ provider: 'openai', authMode: 'workspace', model: 'gpt-5.4-mini', systemPrompt: 'Analise o comprovante.', userMessage: '{{last_message}}', understandAudio: false, understandImage: false, understandPdf: false, identifyReceipt: false, smartConditionals: [], responseVariable: 'resposta.gpt', failReasonVariable: 'ai.fail.reason', autoSendResponse: false, contextInteractions: 1 });
  });

  it('exige prompt e limita o contexto', () => {
    expect(AutomationAiConfigSchema.safeParse({ systemPrompt: '' }).success).toBe(false);
    expect(AutomationAiConfigSchema.safeParse({ systemPrompt: 'x', contextInteractions: 21 }).success).toBe(false);
    expect(AutomationAiConfigSchema.safeParse({ systemPrompt: 'x', responseVariable: '1abc' }).success).toBe(false);
    expect(AutomationAiConfigSchema.safeParse({ systemPrompt: 'x', smartConditionals: Array.from({ length: 11 }, (_, i) => ({ id: `route_${i}`, label: `Rota ${i}`, instruction: 'Use nesta situação.' })) }).success).toBe(false);
    expect(AutomationAiConfigSchema.safeParse({ systemPrompt: 'x', smartConditionals: [{ id: 'same', label: 'A', instruction: 'A' }, { id: 'same', label: 'B', instruction: 'B' }] }).success).toBe(false);
  });
});

describe('Integração e chave de IA', () => {
  it('aceita até 20 campos da resposta com variável válida', () => {
    const base = { url: 'https://api.test/x' };
    expect(AutomationWebhookConfigSchema.safeParse({ ...base, responseFields: [{ path: 'body.accepted', variable: 'kovil.receipt.accepted' }] }).success).toBe(true);
    expect(AutomationWebhookConfigSchema.safeParse({ ...base, responseFields: Array.from({ length: 21 }, (_, i) => ({ path: `body.f${i}`, variable: `v${i}` })) }).success).toBe(false);
    expect(AutomationWebhookConfigSchema.safeParse({ ...base, responseFields: [{ path: 'body.x', variable: 'tem espaço' }] }).success).toBe(false);
  });

  it('chave da OpenAI começa com sk-', () => {
    expect(SetAiKeyInput.safeParse({ apiKey: 'sk-proj-0123456789abcdefghij' }).success).toBe(true);
    expect(SetAiKeyInput.safeParse({ apiKey: 'abc' }).success).toBe(false);
  });
});
