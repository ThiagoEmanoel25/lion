import { describe, expect, it } from 'vitest';
import { buildAiMessages, callOpenAi, resolveOpenAiKey, transcribeOpenAiAudio } from './ai-call.js';

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
    expect(await callOpenAi({ ...base, fetchImpl: reply(200, { choices: [{ message: { content: ' #R$15,00 ' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) })).toEqual({ ok: true, text: '#R$15,00', tokens: 15, routeId: null, receiptValid: false });
  });
  it('classifica comprovante e condicional em uma resposta estruturada', async () => {
    let requestBody: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"response":"Pagamento confirmado","receiptValid":true,"conditionId":"paid"}' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(callOpenAi({ ...base, routing: { identifyReceipt: true, conditionals: [{ id: 'paid', label: 'Pagamento', instruction: 'Use quando estiver pago.' }] }, fetchImpl })).resolves.toEqual({ ok: true, text: 'Pagamento confirmado', tokens: 0, routeId: 'paid', receiptValid: true });
    expect(requestBody.response_format).toEqual({ type: 'json_object' });
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
