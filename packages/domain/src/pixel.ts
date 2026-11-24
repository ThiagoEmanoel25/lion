export const META_GRAPH_VERSION = 'v25.0';
export const PIXEL_TIMEOUT_SECONDS = 30;
export const NO_CTWA_MESSAGE = 'Contato não veio de um anúncio de clique para o WhatsApp';

// Accepts `15`, `15,90`, `R$ 15,90`, `1.234,56`. Without a comma a dot is a decimal point (`15.90`, `0.500`),
// except in BR thousands notation with a non-zero lead: `12.345` reads as 12345, not 12.345.
export function parsePixelValue(raw: string): number | null {
  let text = raw.replace(/R\$/gi, '').replace(/\s/g, '');
  if (text.includes(',')) {
    if (!/^(\d{1,3}(\.\d{3})*|\d+),\d+$/.test(text)) return null;
    text = text.replace(/\./g, '').replace(',', '.');
  } else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
  return /^\d+(\.\d+)?$/.test(text) ? Number(text) : null;
}

export function buildPixelEvent(input: { eventName: string; eventTime: number; eventId: string; ctwaClid: string; pageId?: string; value?: number; currency: string }): object {
  return {
    event_name: input.eventName, event_time: input.eventTime, event_id: input.eventId, action_source: 'business_messaging', messaging_channel: 'whatsapp',
    user_data: { ctwa_clid: input.ctwaClid, ...(input.pageId ? { page_id: input.pageId } : {}) },
    custom_data: { ...(input.value !== undefined ? { value: input.value } : {}), currency: input.currency }
  };
}

export const pixelRequest = (pixelId: string, accessToken: string, event: object, testEventCode?: string) => ({
  url: `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(pixelId)}/events`,
  body: JSON.stringify({ data: [event], access_token: accessToken, ...(testEventCode ? { test_event_code: testEventCode } : {}) })
});

export function pixelOutcome(status: number | null, body: unknown, error?: string): { port: 'success' | 'failure'; error?: { status: number | null; message: string } } {
  const record = body && typeof body === 'object' ? body as { events_received?: unknown; error?: { message?: unknown; error_user_title?: unknown; error_user_msg?: unknown } } : {};
  if (!error && status !== null && status >= 200 && status <= 299 && typeof record.events_received === 'number' && record.events_received >= 1) return { port: 'success' };
  // A Meta manda o texto para o usuário (error_user_title/error_user_msg) no idioma da conta; ele diz o que corrigir, ao contrário de "Invalid parameter".
  const userMsg = typeof record.error?.error_user_msg === 'string' ? record.error.error_user_msg.trim() : '';
  const userTitle = typeof record.error?.error_user_title === 'string' ? record.error.error_user_title.trim() : '';
  const friendly = userMsg ? (userTitle ? `${userTitle}. ${userMsg}` : userMsg) : userTitle;
  const metaMessage = friendly || (typeof record.error?.message === 'string' && record.error.message ? record.error.message : undefined);
  return { port: 'failure', error: { status, message: error ?? metaMessage ?? (status !== null && status >= 200 && status <= 299 ? 'A Meta não registrou o evento.' : `A Meta respondeu HTTP ${status}.`) } };
}
