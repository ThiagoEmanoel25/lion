import { describe, expect, it } from 'vitest';
import { manipulateContactField, type FieldTx } from './manipulator.js';

// In-memory store with Serializable semantics: a commit after another commit since the snapshot aborts with P2034.
function fakeDb(initial: Record<string, unknown>) {
  let committed = { ...initial }; let version = 0;
  const db = {
    get fields() { return committed; },
    async $transaction<R>(fn: (tx: { snap: Record<string, unknown>; writes: Record<string, unknown> }) => Promise<R>, _o: { isolationLevel: 'Serializable' }): Promise<R> {
      const tx = { snap: { ...committed }, writes: {} as Record<string, unknown> }; const seen = version;
      const out = await fn(tx);
      if (version !== seen) throw { code: 'P2034' };
      committed = { ...committed, ...tx.writes }; version += 1;
      return out;
    }
  };
  const field = (name: string) => (tx: { snap: Record<string, unknown>; writes: Record<string, unknown> }): FieldTx => ({
    get: async () => { await new Promise(r => setTimeout(r, 5)); return tx.snap[name]; },
    set: async value => { await new Promise(r => setTimeout(r, 5)); tx.writes[name] = value; }
  });
  return { db, field };
}

describe('manipulateContactField', () => {
  it('two concurrent "add 1" end at 2', async () => {
    const { db, field } = fakeDb({});
    const run = () => manipulateContactField(db, field('tentativas'), { operation: 'add', operand: '1' }, async () => {});
    const results = await Promise.all([run(), run()]);
    expect(results.every(r => r.ok)).toBe(true);
    expect(db.fields.tentativas).toBe(2);
  });
  it('ten concurrent increments end at 10', async () => {
    const { db, field } = fakeDb({ n: 0 });
    await Promise.all(Array.from({ length: 10 }, () => manipulateContactField(db, field('n'), { operation: 'add', operand: '1' }, async () => {})));
    expect(db.fields.n).toBe(10);
  });
  it('control: unguarded read-then-write loses an update (proves the fake races)', async () => {
    const { db, field } = fakeDb({});
    const naive = async () => { const f = field('x')({ snap: db.fields, writes: db.fields }); const v = ((await f.get()) as number | undefined) ?? 0; await f.set(v + 1); };
    await Promise.all([naive(), naive()]);
    expect(db.fields.x).toBe(1);
  });
  it('reports failure without writing or committing', async () => {
    const { db, field } = fakeDb({ n: 4 });
    let committed = false;
    const r = await manipulateContactField(db, field('n'), { operation: 'divide', operand: '0' }, async () => { committed = true; });
    expect(r.ok).toBe(false); expect(committed).toBe(false); expect(db.fields.n).toBe(4);
  });
});
