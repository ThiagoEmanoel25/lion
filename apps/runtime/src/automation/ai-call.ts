export type AiMedia = { contentType: string; data: Buffer; fileName: string | null };
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string | Array<Record<string, unknown>> };
export type AiCallResult = { ok: true; text: string; tokens: number } | { ok: false; reason: string };

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

export async function callOpenAi(input: { apiKey: string; model: string; messages: ChatMessage[]; baseUrl?: string; timeoutMs?: number; fetchImpl?: typeof fetch }): Promise<AiCallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 60_000);
  try {
    const response = await (input.fetchImpl ?? fetch)(`${(input.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: input.model, messages: input.messages }),
      signal: controller.signal
    });
    if (!response.ok) return { ok: false, reason: response.status === 401 ? 'Chave da OpenAI inválida.' : response.status === 429 ? 'Limite ou créditos da OpenAI esgotados.' : `A OpenAI respondeu HTTP ${response.status}.` };
    const body = await response.json() as { choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const message = body.choices?.[0]?.message;
    if (message?.refusal) return { ok: false, reason: `A IA recusou: ${message.refusal}`.slice(0, 500) };
    const text = message?.content?.trim();
    if (!text) return { ok: false, reason: 'A IA não retornou texto.' };
    return { ok: true, text: text.slice(0, 8000), tokens: (body.usage?.prompt_tokens ?? 0) + (body.usage?.completion_tokens ?? 0) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error && error.name === 'AbortError' ? 'A IA não respondeu em 60 segundos.' : 'Não foi possível conectar à OpenAI.' };
  } finally {
    clearTimeout(timer);
  }
}
