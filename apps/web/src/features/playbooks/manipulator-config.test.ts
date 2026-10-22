import { describe, expect, it } from 'vitest';
import { manipulatorError, manipulatorSummary, splitTarget } from './manipulator-config';

describe('manipulator-config', () => {
  it('resume a operação para o canvas', () => {
    expect(manipulatorSummary({ target: 'contact.customFields.tentativas', operation: 'set', value: '0' })).toBe('Definir tentativas = 0');
    expect(manipulatorSummary({ target: 'contact.customFields.tentativas', operation: 'add', value: '1' })).toBe('Somar 1 a tentativas');
    expect(manipulatorSummary({ target: '', operation: 'add', value: '1' })).toBe('Escolha o campo ou a variável');
  });
  it('separa destino e valida o nome', () => {
    expect(splitTarget('flow.a.b')).toEqual({ scope: 'flow', name: 'a.b' });
    expect(splitTarget('contact.customFields.x')).toEqual({ scope: 'contact', name: 'x' });
    expect(manipulatorError('tentativas', '1')).toBe('');
    expect(manipulatorError('_runtime.x', '1')).not.toBe('');
    expect(manipulatorError('x', '{{global.token}}')).not.toBe('');
  });
});
