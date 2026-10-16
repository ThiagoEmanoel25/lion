import { describe, expect, it } from 'vitest';
import { integrationOutcome, parseResponseFields } from './integration.js';
import { selectPortEdge, type AutomationEdge } from './routing.js';

const fields = [{ path: 'body.accepted', variable: 'kovil.receipt.accepted' }, { path: 'status', variable: 'kovil.status' }];

describe('integrationOutcome', () => {
  it('sucesso grava campos mapeados, resposta inteira e webhook', () => {
    const result = integrationOutcome({ context: { lead: 1 }, status: 200, body: '{"accepted":true}', responseVariable: 'raw', responseFields: fields });
    expect(result.port).toBe('success');
    expect(result.context).toMatchObject({ lead: 1, raw: { accepted: true }, kovil: { receipt: { accepted: true }, status: 200 }, webhook: { status: 200, body: { accepted: true } } });
  });

  it('HTTP fora de 2xx segue erro com integration.error', () => {
    const result = integrationOutcome({ context: {}, status: 422, body: '{"message":"duplicado"}', responseFields: fields });
    expect(result.port).toBe('failure');
    expect(result.context).toMatchObject({ integration: { error: { status: 422, message: 'A integração respondeu HTTP 422.' } } });
  });

  it('erro de rede ou timeout segue erro sem status', () => {
    const result = integrationOutcome({ context: {}, status: null, body: null, error: 'A integração não respondeu em 15 segundos.', responseFields: [] });
    expect(result.port).toBe('failure');
    expect(result.context).toMatchObject({ integration: { error: { status: null, message: 'A integração não respondeu em 15 segundos.' } } });
  });

  it('com campos mapeados, resposta que não é JSON vira erro', () => {
    expect(integrationOutcome({ context: {}, status: 200, body: 'ok', responseFields: fields }).port).toBe('failure');
    expect(integrationOutcome({ context: {}, status: 200, body: 'ok', responseFields: [] }).port).toBe('success');
  });
});

describe('parseResponseFields', () => {
  it('descarta itens inválidos e limita a 20', () => {
    expect(parseResponseFields([{ path: 'body.a', variable: 'a' }, { path: '', variable: 'b' }, null])).toEqual([{ path: 'body.a', variable: 'a' }]);
    expect(parseResponseFields(Array.from({ length: 25 }, (_, i) => ({ path: `body.${i}`, variable: `v${i}` })))).toHaveLength(20);
  });
});

describe('selectPortEdge', () => {
  const edges = [
    { id: 'legacy', source: 'api', target: 'ok', isDefault: false, priority: 0 },
    { id: 'fail', source: 'api', target: 'bad', port: 'failure', isDefault: false, priority: 0 }
  ] as AutomationEdge[];
  it('conexão sem porta atende sucesso', () => {
    expect(selectPortEdge(edges, 'api', 'success')?.id).toBe('legacy');
    expect(selectPortEdge(edges, 'api', 'failure')?.id).toBe('fail');
    expect(selectPortEdge(edges, 'other', 'success')).toBeUndefined();
  });
});
