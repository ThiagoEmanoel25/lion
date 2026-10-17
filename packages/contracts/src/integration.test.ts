import { describe, expect, it } from 'vitest';
import { extractResponseField, renderUrlTemplate, responsePaths } from './integration.js';

const response = { status: 200, body: { accepted: true, nested: { id: 7 }, none: null }, headers: { 'x-id': 'abc' } };

describe('extractResponseField', () => {
  it('lê status, body e headers', () => {
    expect(extractResponseField(response, 'status')).toEqual({ found: true, value: 200 });
    expect(extractResponseField(response, 'body.nested.id')).toEqual({ found: true, value: 7 });
    expect(extractResponseField(response, 'headers.x-id')).toEqual({ found: true, value: 'abc' });
  });
  it('null existente é encontrado; caminho ausente não', () => {
    expect(extractResponseField(response, 'body.none')).toEqual({ found: true, value: null });
    expect(extractResponseField(response, 'body.missing').found).toBe(false);
    expect(extractResponseField({ ...response, body: 'texto' }, 'body.x').found).toBe(false);
  });
});

describe('renderUrlTemplate', () => {
  it('codifica valores interpolados e preserva o resto da URL', () => {
    expect(renderUrlTemplate('https://a.com/{{q}}?n={{contact.name}}', { q: 'a/b', contact: { name: 'Ana & Zé' } })).toBe('https://a.com/a%2Fb?n=Ana%20%26%20Z%C3%A9');
  });
  it('variável ausente vira vazio e objeto vira JSON codificado', () => {
    expect(renderUrlTemplate('https://a.com/{{x}}/{{o}}', { o: { a: 1 } })).toBe('https://a.com//%7B%22a%22%3A1%7D');
  });
});

describe('responsePaths', () => {
  it('lista status e folhas do body, com arrays por índice', () => {
    expect(responsePaths({ status: 200, body: { a: { b: 1 }, list: [{ id: 1 }, 'x'], n: null } })).toEqual(['status', 'body.a.b', 'body.list.0.id', 'body.list.1', 'body.n']);
  });
  it('limita a 50 caminhos e aceita body textual', () => {
    expect(responsePaths({ status: 200, body: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`k${i}`, i])) })).toHaveLength(50);
    expect(responsePaths({ status: 500, body: 'texto' })).toEqual(['status', 'body']);
  });
});
