export const FLOW_JUMP_MAX_DEPTH = 10;

export const FLOW_JUMP_ERRORS = {
  targetRequired: 'FLOW_JUMP_TARGET_REQUIRED',
  targetNotFound: 'FLOW_JUMP_TARGET_NOT_FOUND',
  targetUnpublished: 'FLOW_JUMP_TARGET_UNPUBLISHED',
  limit: 'FLOW_JUMP_LIMIT'
} as const;

export type FlowJumpErrorCode = typeof FLOW_JUMP_ERRORS[keyof typeof FLOW_JUMP_ERRORS];

export class FlowJumpError extends Error {
  constructor(public readonly code: FlowJumpErrorCode, message: string) {
    super(message);
    this.name = 'FlowJumpError';
  }
}

export type FlowJumpTargetSnapshot = {
  id: string;
  workspaceId: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  activeVersionId: string | null;
  name?: string;
};

export type ResolvedFlowJumpTarget = {
  playbookId: string;
  playbookVersionId: string;
  name?: string;
};

export type FlowJumpPlan = {
  target: ResolvedFlowJumpTarget;
  sourceExecution: {
    status: 'SUCCEEDED';
    currentNode: string;
  };
  sourceStep: {
    status: 'SUCCEEDED';
    output: { jumpedTo: string };
  };
  targetExecution: {
    workspaceId: string;
    conversationId: string;
    playbookVersionId: string;
    currentNode: null;
    context: { _runtime: { jumpDepth: number } };
  };
};

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/**
 * Reads only a valid persisted depth. Invalid or legacy values are treated as a
 * first execution, keeping corrupt context from bypassing the loop guard.
 */
export function flowJumpDepthOf(context: unknown): number {
  const runtime = objectRecord(objectRecord(context)?._runtime);
  const depth = runtime?.jumpDepth;
  return typeof depth === 'number' && Number.isSafeInteger(depth) && depth >= 0 ? depth : 0;
}

/**
 * A jumped execution intentionally receives no variables from its predecessor.
 * The only carried value is the incremented loop guard.
 */
export function nextFlowJumpContext(previousContext: unknown): { _runtime: { jumpDepth: number } } {
  const jumpDepth = flowJumpDepthOf(previousContext) + 1;
  if (jumpDepth > FLOW_JUMP_MAX_DEPTH) {
    throw new FlowJumpError(
      FLOW_JUMP_ERRORS.limit,
      `O limite de ${FLOW_JUMP_MAX_DEPTH} saltos consecutivos entre fluxos foi excedido.`
    );
  }
  return { _runtime: { jumpDepth } };
}

/**
 * Resolves a target without leaking the existence of flows from other
 * workspaces. The runtime query should use id + workspaceId as well; the checks
 * remain here as a defence against an incorrectly broad query.
 */
export function resolveFlowJumpTarget(input: {
  workspaceId: string;
  targetPlaybookId: unknown;
  target?: FlowJumpTargetSnapshot | null;
}): ResolvedFlowJumpTarget {
  const targetPlaybookId = typeof input.targetPlaybookId === 'string'
    ? input.targetPlaybookId.trim()
    : '';
  if (!targetPlaybookId) {
    throw new FlowJumpError(FLOW_JUMP_ERRORS.targetRequired, 'Selecione o fluxo de destino.');
  }

  const target = input.target;
  if (!target || target.id !== targetPlaybookId || target.workspaceId !== input.workspaceId) {
    throw new FlowJumpError(FLOW_JUMP_ERRORS.targetNotFound, 'O fluxo de destino não existe neste workspace.');
  }
  if (target.status !== 'PUBLISHED' || !target.activeVersionId) {
    throw new FlowJumpError(FLOW_JUMP_ERRORS.targetUnpublished, 'O fluxo de destino precisa ter uma versão publicada.');
  }

  return {
    playbookId: target.id,
    playbookVersionId: target.activeVersionId,
    ...(target.name ? { name: target.name } : {})
  };
}

/**
 * Produces every deterministic write needed by the engine. The caller must
 * apply the step update, source execution update and target execution create in
 * one Prisma transaction. The same transaction should also create an
 * `automation.execution.requested` outbox event for the target execution.
 */
export function prepareFlowJump(input: {
  workspaceId: string;
  conversationId: string;
  sourceNodeId: string;
  sourceContext: unknown;
  targetPlaybookId: unknown;
  target?: FlowJumpTargetSnapshot | null;
}): FlowJumpPlan {
  const target = resolveFlowJumpTarget(input);
  const context = nextFlowJumpContext(input.sourceContext);

  return {
    target,
    sourceExecution: { status: 'SUCCEEDED', currentNode: input.sourceNodeId },
    sourceStep: { status: 'SUCCEEDED', output: { jumpedTo: target.playbookId } },
    targetExecution: {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      playbookVersionId: target.playbookVersionId,
      currentNode: null,
      context
    }
  };
}
