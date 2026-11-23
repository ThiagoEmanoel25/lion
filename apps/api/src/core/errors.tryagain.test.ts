import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { DomainError } from '@nexo/domain';
import errors from './errors.js';

describe('errors: TRY_AGAIN', () => {
  it('P2034/40001/40P01 viram 503 TRY_AGAIN com retry-after; demais seguem iguais', async () => {
    const app = Fastify({ logger: false });
    await app.register(errors);
    app.get('/p/:c', async req => { const c = (req.params as { c: string }).c; throw c === 'dom' ? new DomainError('X', 'x', 409) : c === 'other' ? new Error('boom') : Object.assign(new Error('t'), { code: c }); });
    for (const c of ['P2034', '40001', '40P01']) {
      const r = await app.inject({ url: `/p/${c}` });
      expect(r.statusCode).toBe(503); expect(r.json().code).toBe('TRY_AGAIN'); expect(r.headers['retry-after']).toBe('1');
    }
    expect((await app.inject({ url: '/p/dom' })).statusCode).toBe(409);
    expect((await app.inject({ url: '/p/other' })).statusCode).toBe(500);
    await app.close();
  });
});
