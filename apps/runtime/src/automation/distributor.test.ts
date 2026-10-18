import { describe, expect, it } from 'vitest';
import { decideDistributorAssignment, incrementDistributorCount, selectWeightedDistributorOutput, type DistributorCount, type DistributorOutput } from './distributor.js';

describe('distributor', () => {
  const equalOutputs: DistributorOutput[] = [
    { id: 'a', name: 'Copy A', weight: 1 },
    { id: 'b', name: 'Copy B', weight: 1 },
    { id: 'c', name: 'Copy C', weight: 1 }
  ];

  it('uses the lowest assigned/weight ratio and breaks ties by output order', () => {
    expect(selectWeightedDistributorOutput(equalOutputs, []).id).toBe('a');
    expect(selectWeightedDistributorOutput(equalOutputs, [
      { outputId: 'a', count: 8 },
      { outputId: 'b', count: 7 },
      { outputId: 'c', count: 7 }
    ]).id).toBe('b');
  });

  it('produces a deterministic weighted round-robin sequence', () => {
    const outputs: DistributorOutput[] = [
      { id: 'a', name: 'Principal', weight: 2 },
      { id: 'b', name: 'Variação', weight: 1 }
    ];
    let counts: DistributorCount[] = [];
    const selected: string[] = [];

    for (let index = 0; index < 6; index += 1) {
      const output = selectWeightedDistributorOutput(outputs, counts);
      selected.push(output.id);
      counts = incrementDistributorCount(counts, output.id);
    }

    expect(selected).toEqual(['a', 'b', 'a', 'a', 'b', 'a']);
    expect(counts).toEqual(expect.arrayContaining([
      { outputId: 'a', count: 4 },
      { outputId: 'b', count: 2 }
    ]));
  });

  it('reuses a valid assignment without incrementing the unique-contact counter', () => {
    expect(decideDistributorAssignment({
      outputs: equalOutputs,
      counts: [{ outputId: 'a', count: 10 }, { outputId: 'b', count: 10 }],
      preventRepeat: true,
      existingOutputId: 'b'
    })).toEqual({
      outputId: 'b', source: 'existing', assignmentWrite: 'none', incrementCounter: false
    });
  });

  it('reassigns and updates persistence when the previous output was removed', () => {
    expect(decideDistributorAssignment({
      outputs: equalOutputs.slice(0, 2),
      counts: [{ outputId: 'a', count: 3 }, { outputId: 'b', count: 1 }],
      preventRepeat: true,
      existingOutputId: 'removed'
    })).toEqual({
      outputId: 'b', source: 'selected', assignmentWrite: 'update', incrementCounter: true
    });
  });

  it('selects on every visit and does not persist when preventRepeat is disabled', () => {
    expect(decideDistributorAssignment({
      outputs: equalOutputs,
      counts: [{ outputId: 'a', count: 1 }],
      preventRepeat: false,
      existingOutputId: 'a'
    })).toEqual({
      outputId: 'b', source: 'selected', assignmentWrite: 'none', incrementCounter: true
    });
  });

  it('rejects invalid weights, duplicate ids and negative counters', () => {
    expect(() => selectWeightedDistributorOutput([{ id: 'a', name: 'A', weight: 0 }], [])).toThrow('DISTRIBUTOR_WEIGHT_INVALID');
    expect(() => selectWeightedDistributorOutput([
      { id: 'a', name: 'A', weight: 1 },
      { id: 'a', name: 'Outra A', weight: 1 }
    ], [])).toThrow('DISTRIBUTOR_OUTPUT_ID_INVALID');
    expect(() => selectWeightedDistributorOutput(equalOutputs, [{ outputId: 'a', count: -1 }])).toThrow('DISTRIBUTOR_COUNT_INVALID');
  });
});
