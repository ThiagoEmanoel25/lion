export type DistributorOutput = Readonly<{
  id: string;
  name: string;
  weight: number;
}>;

export type DistributorCount = Readonly<{
  outputId: string;
  count: number;
}>;

export type DistributorAssignmentDecision = Readonly<{
  outputId: string;
  source: 'existing' | 'selected';
  assignmentWrite: 'none' | 'create' | 'update';
  incrementCounter: boolean;
}>;

function validateOutputs(outputs: readonly DistributorOutput[]) {
  if (outputs.length === 0) throw new Error('DISTRIBUTOR_OUTPUT_REQUIRED');
  const ids = new Set<string>();
  for (const output of outputs) {
    if (!output.id || ids.has(output.id)) throw new Error('DISTRIBUTOR_OUTPUT_ID_INVALID');
    if (!Number.isInteger(output.weight) || output.weight < 1) throw new Error('DISTRIBUTOR_WEIGHT_INVALID');
    ids.add(output.id);
  }
}

function countMapOf(counts: readonly DistributorCount[]) {
  const result = new Map<string, number>();
  for (const item of counts) {
    if (!Number.isSafeInteger(item.count) || item.count < 0) throw new Error('DISTRIBUTOR_COUNT_INVALID');
    result.set(item.outputId, item.count);
  }
  return result;
}

/**
 * Selects the first output with the lowest assigned/weight ratio.
 * Cross multiplication keeps ties deterministic without floating-point division.
 */
export function selectWeightedDistributorOutput(
  outputs: readonly DistributorOutput[],
  counts: readonly DistributorCount[]
): DistributorOutput {
  validateOutputs(outputs);
  const countByOutput = countMapOf(counts);
  let selected = outputs[0]!;
  let selectedCount = countByOutput.get(selected.id) ?? 0;

  for (const candidate of outputs.slice(1)) {
    const candidateCount = countByOutput.get(candidate.id) ?? 0;
    if (BigInt(candidateCount) * BigInt(selected.weight) < BigInt(selectedCount) * BigInt(candidate.weight)) {
      selected = candidate;
      selectedCount = candidateCount;
    }
  }
  return selected;
}

/**
 * Decides both routing and persistence for preventRepeat. The caller performs the
 * assignment upsert and atomic counter increment in the same database transaction.
 */
export function decideDistributorAssignment(input: Readonly<{
  outputs: readonly DistributorOutput[];
  counts: readonly DistributorCount[];
  preventRepeat: boolean;
  existingOutputId?: string | null;
}>): DistributorAssignmentDecision {
  validateOutputs(input.outputs);
  const existingIsAvailable = Boolean(
    input.preventRepeat
    && input.existingOutputId
    && input.outputs.some(output => output.id === input.existingOutputId)
  );

  if (existingIsAvailable) {
    return {
      outputId: input.existingOutputId!,
      source: 'existing',
      assignmentWrite: 'none',
      incrementCounter: false
    };
  }

  const selected = selectWeightedDistributorOutput(input.outputs, input.counts);
  return {
    outputId: selected.id,
    source: 'selected',
    assignmentWrite: input.preventRepeat ? (input.existingOutputId ? 'update' : 'create') : 'none',
    incrementCounter: true
  };
}

/** Applies the decision locally; useful for simulations and deterministic tests. */
export function incrementDistributorCount(
  counts: readonly DistributorCount[],
  outputId: string
): DistributorCount[] {
  const current = countMapOf(counts);
  const previous = current.get(outputId) ?? 0;
  if (previous === Number.MAX_SAFE_INTEGER) throw new Error('DISTRIBUTOR_COUNT_INVALID');
  current.set(outputId, previous + 1);
  return [...current].map(([id, count]) => ({ outputId: id, count }));
}
