import { describe, expect, it } from 'vitest';
import {
  FLOW_JUMP_ERRORS,
  FLOW_JUMP_MAX_DEPTH,
  FlowJumpError,
  flowJumpDepthOf,
  nextFlowJumpContext,
  prepareFlowJump,
  resolveFlowJumpTarget,
  type FlowJumpTargetSnapshot
} from './flow-jump.js';

const target = (overrides: Partial<FlowJumpTargetSnapshot> = {}): FlowJumpTargetSnapshot => ({
  id: 'playbook-target',
  workspaceId: 'workspace-1',
  status: 'PUBLISHED',
  activeVersionId: 'version-3',
  name: 'Funil 02',
  ...overrides
});

const expectCode = (run: () => unknown, code: string) => {
  try {
    run();
    throw new Error('Era esperado um FlowJumpError.');
  } catch (error) {
    expect(error).toBeInstanceOf(FlowJumpError);
    expect((error as FlowJumpError).code).toBe(code);
  }
};

describe('flow jump depth', () => {
  it('começa em um e mantém somente o controle interno no contexto novo', () => {
    const previous = {
      last_message: 'não deve vazar',
      contact: { id: 'contact-1' },
      _runtime: { pendingDelayStepId: 'step-old', error: { code: 'OLD' } }
    };

    expect(nextFlowJumpContext(previous)).toEqual({ _runtime: { jumpDepth: 1 } });
    expect(previous).toHaveProperty('last_message', 'não deve vazar');
  });

  it('permite exatamente dez saltos consecutivos', () => {
    expect(nextFlowJumpContext({ _runtime: { jumpDepth: FLOW_JUMP_MAX_DEPTH - 1 } }))
      .toEqual({ _runtime: { jumpDepth: FLOW_JUMP_MAX_DEPTH } });
  });

  it('falha quando o próximo salto ultrapassa dez', () => {
    expectCode(
      () => nextFlowJumpContext({ _runtime: { jumpDepth: FLOW_JUMP_MAX_DEPTH } }),
      FLOW_JUMP_ERRORS.limit
    );
  });

  it('não aceita profundidades negativas, fracionárias ou textuais como estado válido', () => {
    expect(flowJumpDepthOf({ _runtime: { jumpDepth: -1 } })).toBe(0);
    expect(flowJumpDepthOf({ _runtime: { jumpDepth: 2.5 } })).toBe(0);
    expect(flowJumpDepthOf({ _runtime: { jumpDepth: '10' } })).toBe(0);
    expect(flowJumpDepthOf(null)).toBe(0);
  });
});

describe('flow jump target', () => {
  it('resolve somente a versão ativa de um fluxo publicado do mesmo workspace', () => {
    expect(resolveFlowJumpTarget({
      workspaceId: 'workspace-1',
      targetPlaybookId: 'playbook-target',
      target: target()
    })).toEqual({ playbookId: 'playbook-target', playbookVersionId: 'version-3', name: 'Funil 02' });
  });

  it('exige um destino configurado', () => {
    expectCode(
      () => resolveFlowJumpTarget({ workspaceId: 'workspace-1', targetPlaybookId: ' ', target: null }),
      FLOW_JUMP_ERRORS.targetRequired
    );
  });

  it('trata fluxo ausente, id divergente ou de outro workspace como não encontrado', () => {
    for (const candidate of [
      null,
      target({ id: 'outro' }),
      target({ workspaceId: 'workspace-2' })
    ]) {
      expectCode(
        () => resolveFlowJumpTarget({ workspaceId: 'workspace-1', targetPlaybookId: 'playbook-target', target: candidate }),
        FLOW_JUMP_ERRORS.targetNotFound
      );
    }
  });

  it('recusa destino rascunho, arquivado ou sem versão ativa', () => {
    for (const candidate of [
      target({ status: 'DRAFT' }),
      target({ status: 'ARCHIVED' }),
      target({ activeVersionId: null })
    ]) {
      expectCode(
        () => resolveFlowJumpTarget({ workspaceId: 'workspace-1', targetPlaybookId: 'playbook-target', target: candidate }),
        FLOW_JUMP_ERRORS.targetUnpublished
      );
    }
  });
});

describe('flow jump plan', () => {
  it('prepara o encerramento atual e a nova execução para a mesma transação', () => {
    expect(prepareFlowJump({
      workspaceId: 'workspace-1',
      conversationId: 'conversation-7',
      sourceNodeId: 'jump-node',
      sourceContext: { customer: { name: 'Maria' }, _runtime: { jumpDepth: 3 } },
      targetPlaybookId: 'playbook-target',
      target: target()
    })).toEqual({
      target: { playbookId: 'playbook-target', playbookVersionId: 'version-3', name: 'Funil 02' },
      sourceExecution: { status: 'SUCCEEDED', currentNode: 'jump-node' },
      sourceStep: { status: 'SUCCEEDED', output: { jumpedTo: 'playbook-target' } },
      targetExecution: {
        workspaceId: 'workspace-1',
        conversationId: 'conversation-7',
        playbookVersionId: 'version-3',
        currentNode: null,
        context: { _runtime: { jumpDepth: 4 } }
      }
    });
  });
});
