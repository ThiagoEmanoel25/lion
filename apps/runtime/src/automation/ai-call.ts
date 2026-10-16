export type AiMedia = { contentType: string; data: Buffer; fileName: string | null };
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string | Array<Record<string, unknown>> };
export type AiRouting = { identifyReceipt: boolean; conditionals: Array<{ id: string; label: string; instruction: string }> };
export type AiCallResult = { ok: true; text: string; tokens: number; routeId: string | null; receiptValid: boolean } | { ok: false; reason: string };
export type AiTranscriptionResult = { ok: true; text: string } | { ok: false; reason: string };

export function buildAiMessages(input: { systemPrompt: string; userMessage: string; history: Array<{ role: 'user' | 'assistant'; content: string }>; media?: AiMedia | null }): ChatMessage[] {
  let user: ChatMessage['content'] = input.userMessage;
  if (input.media) {
    const dataUrl = `data:${input.media.contentType};base64,${input.media.data.toString('base64')}`;
    user = [
      { type: 'text', text: input.userMessage || '(sem texto)' },
      input.media.contentType === 'application/pdf'
        ? { type: 'file', file: { filename: input.media.fileName ?? 'documento.pdf', file_data: dataUrl } }
        : { type: 'image_url', image_url: { url: dataUrl } }
    ];
  }
  return [{ role: 'system', content: input.systemPrompt }, ...input.history, { role: 'user', content: user }];
}

function routedMessages(messages: ChatMessage[], routing: AiRouting | undefined): ChatMessage[] {
  if (!routing || (!routing.identifyReceipt && !routing.conditionals.length)) return messages;
  const routes = routing.conditionals.map((item, index) => `${index + 1}. ${item.id} — ${item.label}: ${item.instruction}`).join('\n');
  const instruction = [
    'Responda SOMENTE com JSON válido no formato {"response":"texto para o cliente","receiptValid":false,"conditionId":null}.',
    routing.identifyReceipt ? 'receiptValid só pode ser true quando a imagem ou PDF for um comprovante de pagamento legível e válido.' : 'Mantenha receiptValid como false.',
    routes ? `Escolha no máximo uma condição abaixo, por prioridade, e coloque o id em conditionId. Se nenhuma corresponder, use null:\n${routes}` : 'Mantenha conditionId como null.',
    'O campo response deve conter a resposta normal que seria enviada ao cliente.'
  ].join('\n');
  return messages.map((message, index) => index === 0 && message.role === 'system' ? { ...message, content: `${message.content}\n\n${instruction}` } : message);
}

export async function callOpenAi(input: { apiKey: string; model: string; messages: ChatMessage[]; routing?: AiRouting; baseUrl?: string; timeoutMs?: number; fetchImpl?: typeof fetch }): Promise<AiCallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 60_000);
  try {
    const response = await (input.fetchImpl ?? fetch)(`${(input.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: input.model, messages: routedMessages(input.messages, input.routing), ...(input.routing && (input.routing.identifyReceipt || input.routing.conditionals.length) ? { response_format: { type: 'json_object' } } : {}) }),
      signal: controller.signal
    });
    if (!response.ok) return { ok: false, reason: response.status === 401 ? 'Chave da OpenAI inválida.' : response.status === 429 ? 'Limite ou créditos da OpenAI esgotados.' : `A OpenAI respondeu HTTP ${response.status}.` };
    const body = await response.json() as { choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const message = body.choices?.[0]?.message;
    if (message?.refusal) return { ok: false, reason: `A IA recusou: ${message.refusal}`.slice(0, 500) };
    const raw = message?.content?.trim();
    if (!raw) return { ok: false, reason: 'A IA não retornou texto.' };
    let text = raw; let routeId: string | null = null; let receiptValid = false;
    if (input.routing && (input.routing.identifyReceipt || input.routing.conditionals.length)) {
      try {
        const parsed = JSON.parse(raw) as { response?: unknown; conditionId?: unknown; receiptValid?: unknown };
        if (typeof parsed.response !== 'string' || !parsed.response.trim()) throw new Error('invalid response');
        text = parsed.response.trim();
        const validIds = new Set(input.routing.conditionals.map(item => item.id));
        routeId = typeof parsed.conditionId === 'string' && validIds.has(parsed.conditionId) ? parsed.conditionId : null;
        receiptValid = input.routing.identifyReceipt && parsed.receiptValid === true;
      } catch { return { ok: false, reason: 'A IA retornou uma classificação inválida.' }; }
    }
    return { ok: true, text: text.slice(0, 8000), tokens: (body.usage?.prompt_tokens ?? 0) + (body.usage?.completion_tokens ?? 0), routeId, receiptValid };
  } catch (error) {
    return { ok: false, reason: error instanceof Error && error.name === 'AbortError' ? 'A IA não respondeu em 60 segundos.' : 'Não foi possível conectar à OpenAI.' };
  } finally {
    clearTimeout(timer);
  }
}

export async function transcribeOpenAiAudio(input: { apiKey: string; media: AiMedia; baseUrl?: string; timeoutMs?: number; fetchImpl?: typeof fetch }): Promise<AiTranscriptionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 60_000);
  try {
    const form = new FormData();
    form.append('model', process.env.OPENAI_TRANSCRIPTION_MODEL ?? 'gpt-4o-mini-transcribe');
    form.append('file', new Blob([new Uint8Array(input.media.data)], { type: input.media.contentType }), input.media.fileName ?? 'audio.ogg');
    const response = await (input.fetchImpl ?? fetch)(`${(input.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/audio/transcriptions`, {
      method: 'POST', headers: { authorization: `Bearer ${input.apiKey}` }, body: form, signal: controller.signal
    });
    if (!response.ok) return { ok: false, reason: response.status === 401 ? 'Chave da OpenAI inválida.' : response.status === 429 ? 'Limite ou créditos da OpenAI esgotados.' : `A transcrição respondeu HTTP ${response.status}.` };
    const body = await response.json() as { text?: unknown };
    return typeof body.text === 'string' && body.text.trim() ? { ok: true, text: body.text.trim().slice(0, 8000) } : { ok: false, reason: 'A IA não conseguiu entender o áudio.' };
  } catch (error) {
    return { ok: false, reason: error instanceof Error && error.name === 'AbortError' ? 'A transcrição não respondeu em 60 segundos.' : 'Não foi possível transcrever o áudio.' };
  } finally { clearTimeout(timer); }
}

export function resolveOpenAiKey(stored: string | null, envKey: string | undefined, decrypt: (value: string) => string): { ok: true; key: string } | { ok: false; reason: string } {
  if (stored) {
    try { return { ok: true, key: decrypt(stored) }; } catch { return { ok: false, reason: 'Chave da OpenAI inválida ou corrompida. Salve a chave novamente em Configurações.' }; }
  }
  return envKey ? { ok: true, key: envKey } : { ok: false, reason: 'Chave da OpenAI não configurada.' };
}
