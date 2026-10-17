import { describe, expect, it } from 'vitest';
import { META_GRAPH_VERSION, buildPixelEvent, parsePixelValue, pixelOutcome, pixelRequest } from './pixel.js';

describe('pixel', () => {
  it('parses BR and plain values', () => {
    expect(parsePixelValue('15')).toBe(15);
    expect(parsePixelValue('15,90')).toBe(15.9);
    expect(parsePixelValue('R$ 15,90')).toBe(15.9);
    expect(parsePixelValue('1.234,56')).toBe(1234.56);
    expect(parsePixelValue('1.234')).toBe(1234);
    expect(parsePixelValue('15.90')).toBe(15.9);
    expect(parsePixelValue('0')).toBe(0);
  });

  it('rejects invalid values', () => {
    for (const raw of ['', '  ', 'abc', '-5', '{{valor}}', '1,2,3', 'R$']) expect(parsePixelValue(raw)).toBeNull();
  });

  it('builds the data[0] event, omitting empty page and value', () => {
    expect(buildPixelEvent({ eventName: 'Purchase', eventTime: 1_700_000_000, eventId: 'step_1', ctwaClid: 'clid', pageId: '123', value: 15.9, currency: 'BRL' })).toEqual({
      event_name: 'Purchase', event_time: 1_700_000_000, event_id: 'step_1', action_source: 'business_messaging', messaging_channel: 'whatsapp',
      user_data: { ctwa_clid: 'clid', page_id: '123' }, custom_data: { value: 15.9, currency: 'BRL' }
    });
    const lead = buildPixelEvent({ eventName: 'LeadSubmitted', eventTime: 1, eventId: 's', ctwaClid: 'c', pageId: '', currency: 'BRL' }) as Record<string, unknown>;
    expect(lead.user_data).toEqual({ ctwa_clid: 'c' });
    expect(lead.custom_data).toEqual({ currency: 'BRL' });
  });

  it('keeps the token in the body, never in the URL', () => {
    const request = pixelRequest('987', 'SECRET_TOKEN', { event_name: 'Purchase' });
    expect(request.url).toBe(`https://graph.facebook.com/${META_GRAPH_VERSION}/987/events`);
    expect(request.url).not.toContain('SECRET_TOKEN');
    expect(JSON.parse(request.body)).toEqual({ data: [{ event_name: 'Purchase' }], access_token: 'SECRET_TOKEN' });
    expect(META_GRAPH_VERSION).toBe('v25.0');
  });

  it('succeeds only on 2xx with events_received >= 1', () => {
    expect(pixelOutcome(200, { events_received: 1 })).toEqual({ port: 'success' });
    expect(pixelOutcome(200, { events_received: 0 }).port).toBe('failure');
    expect(pixelOutcome(200, 'not json').port).toBe('failure');
    expect(pixelOutcome(302, { events_received: 1 }).port).toBe('failure');
  });

  it('reports the Meta error message and transport errors', () => {
    expect(pixelOutcome(400, { error: { message: 'Invalid OAuth access token.' } })).toEqual({ port: 'failure', error: { status: 400, message: 'Invalid OAuth access token.' } });
    expect(pixelOutcome(500, null)).toEqual({ port: 'failure', error: { status: 500, message: 'A Meta respondeu HTTP 500.' } });
    expect(pixelOutcome(null, null, 'timeout')).toEqual({ port: 'failure', error: { status: null, message: 'timeout' } });
  });
});
