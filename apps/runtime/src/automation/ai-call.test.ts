import { describe, expect, it } from 'vitest';
import { buildAiMessages, callOpenAi, resolveOpenAiKey, transcribeOpenAiAudio } from './ai-call.js';
import { EMPTY_RECEIPT } from '@nexo/domain';

const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('buildAiMessages', () => {
  it('texto puro: sistema, histórico e usuário', () => {
    expect(buildAiMessages({ systemPrompt: 'Sistema', userMessage: 'oi', history: [{ role: 'assistant', content: 'olá' }] })).toEqual([
      { role: 'system', content: 'Sistema' }, { role: 'assistant', content: 'olá' }, { role: 'user', content: 'oi' }
    ]);
  });

  it('anexa imagem como image_url e PDF como file', () => {
    const image = buildAiMessages({ systemPrompt: 's', userMessage: 'veja', history: [], media: { contentType: 'image/png', data: Buffer.from('x'), fileName: null } });
    expect(image[1]).toEqual({ role: 'user', content: [{ type: 'text', text: 'veja' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,eA==' } }] });
    const pdf = buildAiMessages({ systemPrompt: 's', userMessage: '', history: [], media: { contentType: 'application/pdf', data: Buffer.from('x'), fileName: 'c.pdf' } });
    expect(pdf[1]).toEqual({ role: 'user', content: [{ type: 'text', text: '(sem texto)' }, { type: 'file', file: { filename: 'c.pdf', file_data: 'data:application/pdf;base64,eA==' } }] });
  });
});

describe('callOpenAi', () => {
  const base = { apiKey: 'sk-test', model: 'gpt-5.4-mini', messages: [{ role: 'user' as const, content: 'oi' }] };
  it('sucesso devolve texto e tokens', async () => {
    expect(await callOpenAi({ ...base, fetchImpl: reply(200, { choices: [{ message: { content: ' #R$15,00 ' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) })).toEqual({ ok: true, text: '#R$15,00', tokens: 15, routeId: null, receiptValid: false, receipt: EMPTY_RECEIPT });
  });
  it('classifica comprovante e condicional em uma resposta estruturada', async () => {
    let requestBody: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"response":"Pagamento confirmado","receiptValid":true,"conditionId":"paid","receipt":{"valor":"R$ 1.250,00","nome_pagador":"Maria Silva","data":"05/10/2026","referencia":"E4455"}}' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(callOpenAi({ ...base, routing: { identifyReceipt: true, conditionals: [{ id: 'paid', label: 'Pagamento', instruction: 'Use quando estiver pago.' }] }, fetchImpl })).resolves.toEqual({ ok: true, text: 'Pagamento confirmado', tokens: 0, routeId: 'paid', receiptValid: true, receipt: { valor: 1250, nome_pagador: 'Maria Silva', data: '2026-10-05', referencia: 'E4455' } });
    expect(requestBody.response_format).toEqual({ type: 'json_object' });
  });
  it('não lê os campos de um comprovante que a IA considerou inválido', async () => {
    const fetchImpl = reply(200, { choices: [{ message: { content: '{"response":"Não consegui ler","receiptValid":false,"conditionId":null,"receipt":{"valor":"R$ 999,00","nome_pagador":"Chute"}}' } }] });
    await expect(callOpenAi({ ...base, routing: { identifyReceipt: true, conditionals: [] }, fetchImpl })).resolves.toMatchObject({ ok: true, receiptValid: false, receipt: EMPTY_RECEIPT });
  });
  it('pede os campos do comprovante no prompt só quando a identificação está ligada', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const spy = (async (_url: string | URL | Request, init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ choices: [{ message: { content: '{"response":"ok","receiptValid":false,"conditionId":null}' } }] }), { status: 200 }); }) as unknown as typeof fetch;
    // A instrução de roteamento é anexada ao system prompt, que buildAiMessages sempre coloca em primeiro.
    const withSystem = { ...base, messages: [{ role: 'system' as const, content: 'Você atende.' }, ...base.messages] };
    await callOpenAi({ ...withSystem, routing: { identifyReceipt: true, conditionals: [] }, fetchImpl: spy });
    await callOpenAi({ ...withSystem, routing: { identifyReceipt: false, conditionals: [{ id: 'x', label: 'X', instruction: 'Y' }] }, fetchImpl: spy });
    const systemOf = (body: Record<string, unknown>) => String((body.messages as Array<{ content: string }>)[0]!.content);
    expect(systemOf(bodies[0]!)).toContain('nome_pagador');
    expect(systemOf(bodies[1]!)).not.toContain('nome_pagador');
  });
  it('traduz erros em motivos legíveis', async () => {
    expect(await callOpenAi({ ...base, fetchImpl: reply(401, {}) })).toEqual({ ok: false, reason: 'Chave da OpenAI inválida.' });
    expect(await callOpenAi({ ...base, fetchImpl: reply(429, {}) })).toEqual({ ok: false, reason: 'Limite ou créditos da OpenAI esgotados.' });
    expect(await callOpenAi({ ...base, fetchImpl: reply(200, { choices: [{ message: { content: '' } }] }) })).toEqual({ ok: false, reason: 'A IA não retornou texto.' });
    expect(await callOpenAi({ ...base, fetchImpl: (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch })).toEqual({ ok: false, reason: 'Não foi possível conectar à OpenAI.' });
  });
});

describe('transcribeOpenAiAudio', () => {
  it('envia multipart e devolve a transcrição', async () => {
    let sentBody: BodyInit | null | undefined;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      sentBody = init?.body;
      return new Response(JSON.stringify({ text: 'quero saber o preço' }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(transcribeOpenAiAudio({ apiKey: 'sk-test', media: { contentType: 'audio/ogg', data: Buffer.from('audio'), fileName: 'voz.ogg' }, fetchImpl })).resolves.toEqual({ ok: true, text: 'quero saber o preço' });
    expect(sentBody).toBeInstanceOf(FormData);
  });
});

describe('resolveOpenAiKey', () => {
  const bad = 'Chave da OpenAI inválida ou corrompida. Salve a chave novamente em Configurações.';
  it('chave salva válida é descriptografada', () => {
    expect(resolveOpenAiKey('enc', 'env', v => `dec:${v}`)).toEqual({ ok: true, key: 'dec:enc' });
  });
  it('falha ao descriptografar não cai para a chave do ambiente', () => {
    expect(resolveOpenAiKey('enc', 'env', () => { throw new Error('bad'); })).toEqual({ ok: false, reason: bad });
  });
  it('sem chave salva usa o ambiente; sem nada, não configurada', () => {
    expect(resolveOpenAiKey(null, 'env', v => v)).toEqual({ ok: true, key: 'env' });
    expect(resolveOpenAiKey(null, undefined, v => v)).toEqual({ ok: false, reason: 'Chave da OpenAI não configurada.' });
  });
});
