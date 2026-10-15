import { describe, expect, it } from 'vitest';
import { CONDITION_GROUPS, CONDITION_ITEMS, itemForRule, ruleError, searchConditionItems, valueKind } from './condition-catalog';

const item = (key: string) => CONDITION_ITEMS.find(entry => entry.key === key)!;

describe('condition catalog', () => {
  it('segue os grupos e itens do Leona, na ordem', () => {
    expect(CONDITION_GROUPS).toEqual(['Sistema', 'Atendimento', 'Atendente', 'Campos']);
    expect(CONDITION_ITEMS.map(entry => entry.label)).toEqual([
      'Etiqueta', 'Dia da semana', 'Hora', 'Data', 'Janela de 24h',
      'Aguardando', 'Atendendo', 'Resolvidos',
      'Atendente ativo do chat (lista)',
      'Nome', 'Número', 'Email', 'Campo personalizado', 'Variável do fluxo'
    ]);
  });

  it('cria regras com os campos e valores da spec', () => {
    expect(item('tag').create()).toEqual({ field: 'contact.tagIds', operator: 'in', value: [] });
    expect(item('time').create()).toEqual({ field: 'system.time', operator: 'between', value: ['08:00', '18:00'] });
    expect(item('waiting').create()).toEqual({ field: 'conversation.status', operator: 'equals', value: 'QUEUED' });
    expect(item('attending').create().value).toBe('ASSIGNED');
    expect(item('resolved').create().value).toBe('RESOLVED');
    expect(item('window24h').create()).toEqual({ field: 'conversation.window24h', operator: 'equals', value: true });
  });

  it('reconhece o item de uma regra salva', () => {
    expect(itemForRule({ field: 'conversation.status', operator: 'not_equals', value: 'ASSIGNED' }).key).toBe('attending');
    expect(itemForRule({ field: 'contact.customFields.plano', operator: 'equals', value: 'pro' }).key).toBe('custom');
    expect(itemForRule({ field: 'menu.choice', operator: 'equals', value: 'a' }).key).toBe('variable');
    expect(itemForRule({ field: 'contact.phone', operator: 'contains', value: '71' }).key).toBe('phone');
  });

  it('escolhe o editor de valor pelo item e operador', () => {
    expect(valueKind(item('date'), 'between')).toBe('dateRange');
    expect(valueKind(item('date'), 'equals')).toBe('date');
    expect(valueKind(item('name'), 'exists')).toBe('none');
    expect(valueKind(item('name'), 'contains')).toBe('text');
    expect(valueKind(item('waiting'), 'equals')).toBe('none');
  });

  it('busca ignorando acentos e maiúsculas, também pelo grupo', () => {
    expect(searchConditionItems('numero').map(entry => entry.key)).toEqual(['phone']);
    expect(searchConditionItems('JANELA').map(entry => entry.key)).toEqual(['window24h']);
    expect(searchConditionItems('atendimento').map(entry => entry.key)).toEqual(['waiting', 'attending', 'resolved']);
    expect(searchConditionItems('')).toHaveLength(CONDITION_ITEMS.length);
  });

  it('aponta o que falta em cada tipo de regra', () => {
    expect(ruleError({ field: 'contact.tagIds', operator: 'in', value: [] })).toBe('Selecione ao menos uma etiqueta.');
    expect(ruleError({ field: 'system.weekday', operator: 'in', value: [] })).toBe('Selecione ao menos um dia.');
    expect(ruleError({ field: 'system.time', operator: 'between', value: ['08:00', ''] })).toBe('Informe o horário inicial e final.');
    expect(ruleError({ field: 'system.date', operator: 'equals', value: '' })).toBe('Informe a data.');
    expect(ruleError({ field: 'conversation.assigneeId', operator: 'in', value: [] })).toBe('Selecione ao menos um atendente.');
    expect(ruleError({ field: 'contact.customFields.', operator: 'equals', value: 'x' })).toBe('Informe a chave do campo personalizado.');
    expect(ruleError({ field: '', operator: 'equals', value: 'x' })).toBe('Informe o caminho da variável (ex.: menu.choice).');
    expect(ruleError({ field: 'contact.name', operator: 'equals', value: '' })).toBe('Informe o valor para comparar.');
    expect(ruleError({ field: 'contact.name', operator: 'exists' })).toBe('');
    expect(ruleError({ field: 'conversation.status', operator: 'equals', value: 'QUEUED' })).toBe('');
  });
});
