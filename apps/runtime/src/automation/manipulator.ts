import { applyManipulation, type Operation } from '@nexo/domain';
import { retryTx } from './distributor.js';

export type FieldTx = { get(): Promise<unknown>; set(value: unknown): Promise<void> };
export type ManipulationResult = { ok: true; previous: unknown; value: unknown } | { ok: false; reason: string };

// Read, compute and write share one Serializable transaction: a concurrent writer aborts one side (40001/P2034) and retryTx re-reads, so "add 1" twice always ends at 2.
export async function manipulateContactField<Tx>(
  db: { $transaction<R>(fn: (tx: Tx) => Promise<R>, options: { isolationLevel: 'Serializable' }): Promise<R> },
  field: (tx: Tx) => FieldTx,
  input: { operation: Operation; operand: string },
  commit: (tx: Tx, result: { previous: unknown; value: unknown }) => Promise<void>
): Promise<ManipulationResult> {
  return retryTx(() => db.$transaction(async tx => {
    const f = field(tx);
    const previous = await f.get();
    const result = applyManipulation(previous, input.operation, input.operand);
    if (!result.ok) return result;
    await f.set(result.value);
    await commit(tx, { previous, value: result.value });
    return { ok: true as const, previous, value: result.value };
  }, { isolationLevel: 'Serializable' }));
}
