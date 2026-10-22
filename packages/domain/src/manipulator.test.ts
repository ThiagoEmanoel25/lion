import { describe, expect, it } from 'vitest';
import { applyManipulation, parseTarget } from './manipulator.js';

describe('manipulator', () => {
  it('applies operations', () => {
    expect(applyManipulation(undefined, 'add', '1')).toEqual({ ok: true, value: 1 });
    expect(applyManipulation(5, 'subtract', '2')).toEqual({ ok: true, value: 3 });
    expect(applyManipulation('2', 'add', '1')).toEqual({ ok: true, value: 3 });
    expect(applyManipulation(2, 'multiply', '3')).toEqual({ ok: true, value: 6 });
    expect(applyManipulation(6, 'divide', '3')).toEqual({ ok: true, value: 2 });
    expect(applyManipulation(undefined, 'multiply', '3').ok).toBe(false);
    expect(applyManipulation(undefined, 'divide', '3').ok).toBe(false);
    expect(applyManipulation(4, 'divide', '0').ok).toBe(false);
    expect(applyManipulation('abc', 'add', '1').ok).toBe(false);
    expect(applyManipulation(1, 'add', 'x').ok).toBe(false);
    expect(applyManipulation(null, 'set', '{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(applyManipulation(null, 'set', 'olá')).toEqual({ ok: true, value: 'olá' });
    expect(applyManipulation(null, 'set', 'true')).toEqual({ ok: true, value: true });
  });
  it('parses and guards targets', () => {
    expect(parseTarget('contact.customFields.tentativas')).toEqual({ scope: 'contact', path: 'tentativas' });
    expect(parseTarget('flow.a.b')).toEqual({ scope: 'flow', path: 'a.b' });
    for (const t of ['_runtime.x', 'contact.id', 'contact.customFields.', 'flow._runtime.x', 'flow.workspace', 'flow.api.token', 'flow.a b', 'contact.customFields.' + 'x'.repeat(61), 'flow.a..b']) expect(parseTarget(t)).toBeNull();
  });
});
