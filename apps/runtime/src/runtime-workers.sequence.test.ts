import { describe, expect, it, vi } from 'vitest';
import { RuntimeWorkers } from './runtime-workers.service.js';

type OutboundHarness = { handleOutbound(job: unknown): Promise<void>; sendOutbound(job: unknown): Promise<void> };

const build = (status: 'FAILED' | 'SENT' | 'DELIVERED') => {
  const prisma = {
    message: { findUnique: vi.fn().mockResolvedValue({ status, providerPayload: { sequence: { executionId: 'execution-1', stepId: 'step-1', index: 2 } } }) },
    execution: {
      findUnique: vi.fn().mockResolvedValue({ workspaceId: 'workspace-1', context: { contact: { name: 'Ana' }, _runtime: { pendingSequence: { stepId: 'step-1', index: 2 } } } }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    executionStep: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    outboxEvent: { create: vi.fn().mockResolvedValue({ id: 'outbox-1' }) },
    $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations))
  };
  const worker = new RuntimeWorkers(prisma as never, {} as never, {} as never, {} as never, {} as never);
  const harness = worker as unknown as OutboundHarness;
  vi.spyOn(harness, 'sendOutbound').mockRejectedValue(new Error('provider unavailable'));
  return { harness, prisma };
};

describe('message sequence outbound failure', () => {
  const finalAttempt = { attemptsMade: 2, opts: { attempts: 3 }, data: { messageId: 'message-1' } };

  it('persists a terminal item failure without depending on another queue job', async () => {
    const { harness, prisma } = build('FAILED');
    await expect(harness.handleOutbound(finalAttempt)).rejects.toThrow('provider unavailable');
    expect(prisma.executionStep.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'step-1', executionId: 'execution-1', status: 'RUNNING' },
      data: expect.objectContaining({ status: 'FAILED', reason: 'MESSAGE_ITEM_FAILED: item 3' })
    }));
    expect(prisma.execution.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'execution-1', status: 'WAITING' },
      data: expect.objectContaining({ status: 'FAILED' })
    }));
  });

  it('does not mark the sequence failed when sending succeeded and only continuation failed', async () => {
    const { harness, prisma } = build('SENT');
    await expect(harness.handleOutbound(finalAttempt)).rejects.toThrow('provider unavailable');
    expect(prisma.executionStep.updateMany).not.toHaveBeenCalled();
    expect(prisma.execution.updateMany).not.toHaveBeenCalled();
    expect(prisma.outboxEvent.create).toHaveBeenCalledWith({ data: {
      workspaceId: 'workspace-1', aggregate: 'Execution', aggregateId: 'execution-1', type: 'automation.sequence.continue.requested',
      payload: { executionId: 'execution-1', resumeStepId: 'step-1', sequenceIndex: 3 }
    } });
  });
});
