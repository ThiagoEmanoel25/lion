import type { FastifyPluginAsync } from 'fastify';
import type { Prisma } from '@prisma/client';
import {
  AutomationDefinitionSchema,
  ArchivePlaybookInput,
  CreatePlaybookInput,
  ListExecutionsQuery,
  MovePlaybookFolderInput,
  PlaybookFolderInput,
  PublishPlaybookInput,
  SavePlaybookVersionInput,
  SimulatePlaybookInput,
  StartPlaybookExecutionInput,
  TestIntegrationInput
} from '@nexo/contracts';
import { DomainError } from '@nexo/domain';
import { audit } from '../../core/audit.js';
import { enqueue } from '../../core/outbox.js';
import { simulateAutomation, validateAutomation, type AutomationDefinition } from './compiler.js';
import { assertWorkspaceQuota } from '../billing/service.js';
import { kanbanReferenceIssues } from '../kanban/validation.js';
import { pixelReferenceIssues } from '../pixels/validation.js';
import {IntegrationUrlBlockedError,integrationTestRateLimit,testIntegrationRequest} from './integration-test.js';
import { definitionChecksum } from './checksum.js';
import { registerSimulationRoutes } from './simulation/routes.js';

const node = (id: string, kind: AutomationDefinition['nodes'][number]['kind'], name: string, x: number, y: number, config: Record<string, unknown> = {}) => ({ id, kind, name, config, position: { x, y } });
const templates: Record<'qualification' | 'reactivation' | 'support', AutomationDefinition> = {
  qualification: AutomationDefinitionSchema.parse({
    start: 'trigger',
    nodes: [node('trigger', 'trigger', 'Nova mensagem', 80, 160, { event: 'message.received' }), node('welcome', 'message', 'Boas-vindas', 300, 160, { text: 'Olá! Como posso ajudar?' }), node('qualify', 'condition', 'Lead qualificado?', 520, 160), node('outcome', 'outcome', 'Lead qualificado', 740, 100, { type: 'QUALIFIED' }), node('handoff', 'handoff', 'Transferir para humano', 740, 240)],
    edges: [{ id: 'e1', source: 'trigger', target: 'welcome' }, { id: 'e2', source: 'welcome', target: 'qualify' }, { id: 'e3', source: 'qualify', target: 'outcome', label: 'qualificado', condition: { field: 'contact.stage', operator: 'equals', value: 'qualified' }, priority: 0 }, { id: 'e4', source: 'qualify', target: 'handoff', label: 'outros', isDefault: true }],
    settings: { maxSteps: 30, timeoutSeconds: 300 }
  }),
  reactivation: AutomationDefinitionSchema.parse({
    start: 'trigger',
    nodes: [node('trigger', 'trigger', 'Etiqueta adicionada', 80, 160, { event: 'tag.added' }), node('wait', 'delay', 'Aguardar 24h', 300, 160, { seconds: 86400 }), node('message', 'message', 'Retomar conversa', 520, 160, { text: 'Olá! Podemos retomar nossa conversa?' }), node('outcome', 'outcome', 'Reativação enviada', 740, 160, { type: 'QUALIFIED' })],
    edges: [{ id: 'e1', source: 'trigger', target: 'wait' }, { id: 'e2', source: 'wait', target: 'message' }, { id: 'e3', source: 'message', target: 'outcome' }],
    settings: { maxSteps: 20, timeoutSeconds: 300 }
  }),
  support: AutomationDefinitionSchema.parse({
    start: 'trigger',
    nodes: [node('trigger', 'trigger', 'Nova mensagem', 80, 160, { event: 'message.received' }), node('classify', 'condition', 'Assunto conhecido?', 300, 160), node('answer', 'agent', 'Responder com a base', 520, 100, { prompt: 'Responda somente com base no conhecimento aprovado.' }), node('outcome', 'outcome', 'Atendimento resolvido', 740, 100, { type: 'RESOLVED' }), node('handoff', 'handoff', 'Transferir para equipe', 520, 240)],
    edges: [{ id: 'e1', source: 'trigger', target: 'classify' }, { id: 'e2', source: 'classify', target: 'answer', label: 'conhecido', condition: { field: 'intent.known', operator: 'equals', value: true }, priority: 0 }, { id: 'e3', source: 'classify', target: 'handoff', label: 'sensível', isDefault: true }, { id: 'e4', source: 'answer', target: 'outcome' }],
    settings: { maxSteps: 30, timeoutSeconds: 300 }
  })
};

const checksum = definitionChecksum;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const blockCount = (definition: unknown) => { const nodes = (definition as { nodes?: unknown } | null | undefined)?.nodes; return Array.isArray(nodes) ? nodes.length : 0; };
async function uniqueFolderName<T>(write: () => Promise<T>) {
  try { return await write(); } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') throw new DomainError('FOLDER_NAME_TAKEN', 'Já existe uma pasta com esse nome.', 409);
    throw error;
  }
}

async function validateForWorkspace(prisma:unknown,workspaceId:string,value:unknown){
  const validation=validateAutomation(value);
  if(!validation.definition)return validation;
  const flowJumpTargets=[...new Set(validation.definition.nodes.flatMap(node=>node.kind==='flow_jump'&&typeof node.config.targetPlaybookId==='string'&&node.config.targetPlaybookId.trim()?[node.config.targetPlaybookId]:[]))];
  const existingTargets=flowJumpTargets.length
    ? await (prisma as {playbook:{findMany(args:unknown):Promise<Array<{id:string}>>}}).playbook.findMany({where:{workspaceId,id:{in:flowJumpTargets},status:{not:'ARCHIVED'}},select:{id:true}})
    : [];
  const existingTargetIds=new Set(existingTargets.map(target=>target.id));
  const flowJumpIssues=validation.definition.nodes.flatMap(node=>node.kind==='flow_jump'&&typeof node.config.targetPlaybookId==='string'&&node.config.targetPlaybookId.trim()&&!existingTargetIds.has(node.config.targetPlaybookId)
    ? [{level:'error' as const,code:'FLOW_JUMP_TARGET_NOT_FOUND',message:'O fluxo de destino não existe neste workspace ou está arquivado.',nodeId:node.id}]
    : []);
  const issues=[...validation.issues,...flowJumpIssues,...await kanbanReferenceIssues(prisma,workspaceId,validation.definition),...await pixelReferenceIssues(prisma,workspaceId,validation.definition)];
  return {...validation,valid:!issues.some(issue=>issue.level==='error'),issues};
}

export const playbookRoutes: FastifyPluginAsync = async app => {
  registerSimulationRoutes(app, validateForWorkspace);
  app.get('/v1/playbooks', { preHandler: [app.requirePermission('playbook.read')] }, async request => {
    // ponytail: loads the latest definition to count nodes; switch to a jsonb_array_length raw query if lists get large.
    const items = await app.prisma.playbook.findMany({ where: { workspaceId: request.auth.workspaceId }, include: { activeVersion: { select: { id: true, version: true, publishedAt: true } }, _count: { select: { versions: true } }, versions: { orderBy: { version: 'desc' }, take: 1, select: { definition: true } } }, orderBy: { updatedAt: 'desc' } });
    return items.map(({ versions, ...item }) => ({ ...item, blocks: blockCount(versions[0]?.definition) }));
  });

  app.get('/v1/playbook-folders', { preHandler: [app.requirePermission('playbook.read')] }, async request => app.prisma.playbookFolder.findMany({ where: { workspaceId: request.auth.workspaceId }, orderBy: { position: 'asc' } }));

  app.post('/v1/playbook-folders', { preHandler: [app.requirePermission('playbook.write')] }, async (request, reply) => {
    const { name } = PlaybookFolderInput.parse(request.body);
    const { workspaceId, userId } = request.auth;
    const last = await app.prisma.playbookFolder.findFirst({ where: { workspaceId }, orderBy: { position: 'desc' } });
    const folder = await uniqueFolderName(() => app.prisma.playbookFolder.create({ data: { workspaceId, name, position: (last?.position ?? -1) + 1 } }));
    await audit(app.prisma, { workspaceId, actorId: userId, action: 'playbook_folder.created', targetType: 'PlaybookFolder', targetId: folder.id, changes: { name } });
    return reply.status(201).send(folder);
  });

  app.patch('/v1/playbook-folders/:id', { preHandler: [app.requirePermission('playbook.write')] }, async request => {
    const { id } = request.params as { id: string };
    const { name } = PlaybookFolderInput.parse(request.body);
    const { workspaceId, userId } = request.auth;
    if (!await app.prisma.playbookFolder.count({ where: { id, workspaceId } })) throw new DomainError('FOLDER_NOT_FOUND', 'Pasta não encontrada.', 404);
    const folder = await uniqueFolderName(() => app.prisma.playbookFolder.update({ where: { id }, data: { name } }));
    await audit(app.prisma, { workspaceId, actorId: userId, action: 'playbook_folder.renamed', targetType: 'PlaybookFolder', targetId: id, changes: { name } });
    return folder;
  });

  app.delete('/v1/playbook-folders/:id', { preHandler: [app.requirePermission('playbook.write')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { workspaceId, userId } = request.auth;
    if (!await app.prisma.playbookFolder.count({ where: { id, workspaceId } })) throw new DomainError('FOLDER_NOT_FOUND', 'Pasta não encontrada.', 404);
    await app.prisma.playbookFolder.delete({ where: { id } }); // FK SetNull moves its flows to "Sem pasta".
    await audit(app.prisma, { workspaceId, actorId: userId, action: 'playbook_folder.deleted', targetType: 'PlaybookFolder', targetId: id });
    return reply.status(204).send();
  });

  app.patch('/v1/playbooks/:id/folder', { preHandler: [app.requirePermission('playbook.write')] }, async request => {
    const { id } = request.params as { id: string };
    const { folderId } = MovePlaybookFolderInput.parse(request.body);
    const { workspaceId, userId } = request.auth;
    if (folderId && !await app.prisma.playbookFolder.count({ where: { id: folderId, workspaceId } })) throw new DomainError('FOLDER_NOT_FOUND', 'Pasta não encontrada.', 404);
    const moved = await app.prisma.playbook.updateMany({ where: { id, workspaceId }, data: { folderId } });
    if (!moved.count) throw new DomainError('NOT_FOUND', 'Automação não encontrada.', 404);
    await audit(app.prisma, { workspaceId, actorId: userId, action: 'playbook.folder_changed', targetType: 'Playbook', targetId: id, changes: { folderId } });
    return { id, folderId };
  });

  app.post('/v1/playbooks/:id/pause', { preHandler: [app.requirePermission('playbook.publish')] }, async request => {
    const { id } = request.params as { id: string };
    const { workspaceId, userId } = request.auth;
    const paused = await app.prisma.playbook.updateMany({ where: { id, workspaceId, status: 'PUBLISHED' }, data: { status: 'PAUSED' } });
    if (!paused.count) {
      if (!await app.prisma.playbook.count({ where: { id, workspaceId } })) throw new DomainError('NOT_FOUND', 'Automação não encontrada.', 404);
      throw new DomainError('PLAYBOOK_NOT_ACTIVE', 'Somente fluxos ativos podem ser pausados.', 409);
    }
    await audit(app.prisma, { workspaceId, actorId: userId, action: 'playbook.paused', targetType: 'Playbook', targetId: id });
    return { id, status: 'PAUSED' };
  });

  app.post('/v1/playbooks/:id/resume', { preHandler: [app.requirePermission('playbook.publish')] }, async request => {
    const { id } = request.params as { id: string };
    const { workspaceId, userId } = request.auth;
    const resumed = await app.prisma.playbook.updateMany({ where: { id, workspaceId, status: 'PAUSED', activeVersionId: { not: null } }, data: { status: 'PUBLISHED' } });
    if (!resumed.count) {
      if (!await app.prisma.playbook.count({ where: { id, workspaceId } })) throw new DomainError('NOT_FOUND', 'Automação não encontrada.', 404);
      throw new DomainError('PLAYBOOK_NOT_PAUSED', 'Somente fluxos pausados com versão publicada podem ser ativados.', 409);
    }
    await audit(app.prisma, { workspaceId, actorId: userId, action: 'playbook.resumed', targetType: 'Playbook', targetId: id });
    return { id, status: 'PUBLISHED' };
  });

  async function archiveImpact(db: Prisma.TransactionClient, workspaceId: string, id: string) {
    const [configs, keywords, webhooks, legacyChannels, others, activeExecutions] = await Promise.all([
      db.channelFlowConfig.findMany({ where: { playbookId: id, channel: { workspaceId } }, select: { id: true, slot: true, channel: { select: { id: true, displayName: true } } } }),
      db.channelKeyword.findMany({ where: { playbookId: id, channel: { workspaceId } }, select: { id: true, keyword: true, match: true, channel: { select: { id: true, displayName: true } } } }),
      db.inboundWebhookEndpoint.findMany({ where: { playbookId: id, workspaceId, isActive: true }, select: { id: true, name: true } }),
      db.channel.findMany({ where: { workspaceId, activePlaybookId: id }, select: { id: true, displayName: true } }),
      db.playbook.findMany({ where: { workspaceId, id: { not: id }, activeVersionId: { not: null } }, select: { id: true, name: true, activeVersion: { select: { definition: true } } } }),
      db.execution.count({ where: { workspaceId, playbookVersion: { playbookId: id }, status: { in: ['RUNNING', 'WAITING'] } } })
    ]);
    const flowJumps = others.flatMap(other => {
      const nodes = (other.activeVersion?.definition as { nodes?: Array<{ id?: string; kind?: string; config?: { targetPlaybookId?: unknown } }> } | null)?.nodes ?? [];
      return nodes.filter(item => item.kind === 'flow_jump' && item.config?.targetPlaybookId === id).map(item => ({ playbookId: other.id, playbookName: other.name, nodeId: item.id ?? '' }));
    });
    return {
      slots: configs.map(item => ({ id: item.id, slot: item.slot, channelId: item.channel.id, channelName: item.channel.displayName })),
      keywords: keywords.map(item => ({ id: item.id, keyword: item.keyword, match: item.match, channelId: item.channel.id, channelName: item.channel.displayName })),
      legacyChannels: legacyChannels.map(item => ({ channelId: item.id, channelName: item.displayName })),
      webhooks,
      flowJumps,
      activeExecutions
    };
  }
  const impactCount = (impact: Awaited<ReturnType<typeof archiveImpact>>) => impact.slots.length + impact.keywords.length + impact.legacyChannels.length + impact.webhooks.length + impact.flowJumps.length;

  app.get('/v1/playbooks/:id/archive-impact', { preHandler: [app.requirePermission('playbook.read')] }, async request => {
    const { id } = request.params as { id: string };
    const { workspaceId } = request.auth;
    if (!await app.prisma.playbook.count({ where: { id, workspaceId } })) throw new DomainError('NOT_FOUND', 'Automação não encontrada.', 404);
    return archiveImpact(app.prisma as unknown as Prisma.TransactionClient, workspaceId, id);
  });

  app.post('/v1/playbooks/:id/archive', { preHandler: [app.requirePermission('playbook.publish')] }, async request => {
    const { id } = request.params as { id: string };
    const { workspaceId, userId } = request.auth;
    const { confirmDetach } = ArchivePlaybookInput.parse(request.body ?? {});
    return app.prisma.$transaction(async tx => {
      const playbook = await tx.playbook.findFirst({ where: { id, workspaceId }, select: { id: true, status: true } });
      if (!playbook) throw new DomainError('NOT_FOUND', 'Automação não encontrada.', 404);
      if (playbook.status === 'ARCHIVED') throw new DomainError('PLAYBOOK_ALREADY_ARCHIVED', 'O fluxo já está arquivado.', 409);
      const impact = await archiveImpact(tx, workspaceId, id);
      if (impact.activeExecutions) throw new DomainError('PLAYBOOK_HAS_ACTIVE_EXECUTIONS', 'Existem execuções em andamento. Aguarde ou cancele antes de arquivar.', 409, impact);
      if (impactCount(impact) && !confirmDetach) throw new DomainError('ARCHIVE_NEEDS_CONFIRMATION', 'Este fluxo está em uso. Confirme para desvincular.', 409, impact);
      await tx.channelFlowConfig.deleteMany({ where: { playbookId: id, channel: { workspaceId } } });
      await tx.channelKeyword.deleteMany({ where: { playbookId: id, channel: { workspaceId } } });
      await tx.channel.updateMany({ where: { workspaceId, activePlaybookId: id }, data: { activePlaybookId: null } });
      // Webhooks keep the FK (Restrict); they are deactivated rather than deleted.
      await tx.inboundWebhookEndpoint.updateMany({ where: { playbookId: id, workspaceId }, data: { isActive: false } });
      await tx.playbook.update({ where: { id }, data: { status: 'ARCHIVED', archivedAt: new Date(), activeVersionId: null } });
      await audit(tx, { workspaceId, actorId: userId, action: 'playbook.archived', targetType: 'Playbook', targetId: id, changes: { from: playbook.status, detached: { slots: impact.slots.length, keywords: impact.keywords.length, webhooks: impact.webhooks.length, flowJumpsLeftInvalid: impact.flowJumps.length } } });
      return { id, status: 'ARCHIVED' as const };
    }, { isolationLevel: 'Serializable' });
  });

  app.post('/v1/playbooks/:id/unarchive', { preHandler: [app.requirePermission('playbook.publish')] }, async request => {
    const { id } = request.params as { id: string };
    const { workspaceId, userId } = request.auth;
    const restored = await app.prisma.playbook.updateMany({ where: { id, workspaceId, status: 'ARCHIVED' }, data: { status: 'DRAFT', archivedAt: null } });
    if (!restored.count) {
      if (!await app.prisma.playbook.count({ where: { id, workspaceId } })) throw new DomainError('NOT_FOUND', 'Automação não encontrada.', 404);
      throw new DomainError('PLAYBOOK_NOT_ARCHIVED', 'Somente fluxos arquivados podem ser desarquivados.', 409);
    }
    await audit(app.prisma, { workspaceId, actorId: userId, action: 'playbook.unarchived', targetType: 'Playbook', targetId: id });
    return { id, status: 'DRAFT' as const };
  });

  app.get('/v1/playbooks/:id', { preHandler: [app.requirePermission('playbook.read')] }, async request => {
    const { id } = request.params as { id: string };
    const playbook = await app.prisma.playbook.findFirst({ where: { id, workspaceId: request.auth.workspaceId }, include: { versions: { orderBy: { version: 'desc' } }, activeVersion: true } });
    if (!playbook) throw new DomainError('NOT_FOUND', 'Automação não encontrada.', 404);
    return playbook;
  });

  app.get('/v1/playbooks/:id/distributors', { preHandler: [app.requirePermission('playbook.read')] }, async request => {
    const {id}=request.params as {id:string};
    if(!await app.prisma.playbook.count({where:{id,workspaceId:request.auth.workspaceId}}))throw new DomainError('NOT_FOUND','Automação não encontrada.',404);
    const counts=await app.prisma.flowDistributorCount.findMany({where:{playbookId:id},select:{nodeId:true,outputId:true,count:true},orderBy:[{nodeId:'asc'},{outputId:'asc'}]});
    const grouped=new Map<string,Array<{outputId:string;count:number}>>();
    for(const count of counts)grouped.set(count.nodeId,[...(grouped.get(count.nodeId)??[]),{outputId:count.outputId,count:count.count}]);
    return {items:[...grouped].map(([nodeId,outputs])=>({nodeId,outputs}))};
  });

  app.post('/v1/playbooks', { preHandler: [app.requirePermission('playbook.write')] }, async (request, reply) => {
    const input = CreatePlaybookInput.parse(request.body);
    const definition = templates[input.template];
    const playbook = await app.prisma.playbook.create({ data: { workspaceId: request.auth.workspaceId, name: input.name, description: input.description, versions: { create: { version: 1, definition: json(definition), checksum: checksum(definition), createdById: request.auth.userId } } }, include: { versions: true } });
    return reply.status(201).send(playbook);
  });

  app.post('/v1/playbooks/:id/versions', { preHandler: [app.requirePermission('playbook.write')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = SavePlaybookVersionInput.parse(request.body);
    const validation = await validateForWorkspace(app.prisma,request.auth.workspaceId,input.definition);
    if (!validation.valid || !validation.definition) throw new DomainError('INVALID_AUTOMATION', 'A automação possui erros.', 422, validation.issues);
    try {
      const version = await app.prisma.$transaction(async tx => {
        const playbook = await tx.playbook.findFirst({ where: { id, workspaceId: request.auth.workspaceId }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
        if (!playbook) throw new DomainError('NOT_FOUND', 'Automação não encontrada.', 404);
        if (playbook.status === 'ARCHIVED') throw new DomainError('PLAYBOOK_ARCHIVED', 'Fluxo arquivado é somente leitura. Desarquive para editar.', 409);
        const current = playbook.versions[0]?.version ?? 0;
        if (current !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT', 'Existe uma versão mais recente. Recarregue antes de salvar.', 409, { currentVersion: current });
        const nextChecksum = checksum(validation.definition);
        if (playbook.versions[0]?.checksum === nextChecksum) throw new DomainError('UNCHANGED_DEFINITION', 'Não há alterações para salvar.', 409, { currentVersion: current });
        const created = await tx.playbookVersion.create({ data: { playbookId: id, version: current + 1, definition: json(validation.definition), checksum: nextChecksum, createdById: request.auth.userId } });
        await audit(tx, { workspaceId: request.auth.workspaceId, actorId: request.auth.userId, action: 'playbook.version_created', targetType: 'Playbook', targetId: id, changes: { version: created.version } });
        return created;
      }, { isolationLevel: 'Serializable' });
      return reply.status(201).send(version);
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && (error.code === 'P2002' || error.code === 'P2034')) throw new DomainError('VERSION_CONFLICT', 'Outra versão foi salva ao mesmo tempo. Recarregue antes de tentar novamente.', 409);
      throw error;
    }
  });

  app.post('/v1/playbooks/:id/validate', { preHandler: [app.requirePermission('playbook.write')] }, async request => {
    const { id } = request.params as { id: string };
    const exists = await app.prisma.playbook.count({ where: { id, workspaceId: request.auth.workspaceId } });
    if (!exists) throw new DomainError('NOT_FOUND', 'Automação não encontrada.', 404);
    const definition = AutomationDefinitionSchema.parse((request.body as { definition?: unknown })?.definition);
    return validateForWorkspace(app.prisma,request.auth.workspaceId,definition);
  });

  app.post('/v1/playbooks/:id/simulate', { preHandler: [app.requirePermission('playbook.write')] }, async request => {
    const { id } = request.params as { id: string };
    const input = SimulatePlaybookInput.parse(request.body);
    let definition: unknown = input.definition;
    if (!definition) {
      const version = await app.prisma.playbookVersion.findFirst({ where: { playbookId: id, version: input.version, playbook: { workspaceId: request.auth.workspaceId } } });
      if (!version) throw new DomainError('VERSION_NOT_FOUND', 'Versão da automação não encontrada.', 404);
      definition = version.definition;
    } else if (!await app.prisma.playbook.count({ where: { id, workspaceId: request.auth.workspaceId } })) throw new DomainError('NOT_FOUND', 'Automação não encontrada.', 404);
    const validation = await validateForWorkspace(app.prisma,request.auth.workspaceId,definition);
    if (!validation.valid || !validation.definition) throw new DomainError('INVALID_AUTOMATION', 'A automação possui erros.', 422, validation.issues);
    return { validation, simulation: simulateAutomation(validation.definition, input.variables) };
  });

  app.post('/v1/playbooks/:id/integration/test', { preHandler: [app.requirePermission('playbook.write')] }, async request => {
    const {id}=request.params as {id:string};
    if(!await app.prisma.playbook.count({where:{id,workspaceId:request.auth.workspaceId}}))throw new DomainError('NOT_FOUND','Automação não encontrada.',404);
    const input=TestIntegrationInput.parse(request.body);
    await integrationTestRateLimit(app.redis,request.auth.userId);
    try{return await testIntegrationRequest(input)}catch(error){
      if(error instanceof IntegrationUrlBlockedError)throw new DomainError('INTEGRATION_URL_BLOCKED',error.message,422);
      const message=error instanceof Error?error.message:'Não foi possível testar a integração.';
      throw new DomainError('INTEGRATION_TEST_FAILED',message,502);
    }
  });

  app.post('/v1/playbooks/:id/publish', { preHandler: [app.requirePermission('playbook.publish')] }, async request => {
    const { id } = request.params as { id: string };
    const input = PublishPlaybookInput.parse(request.body);
    return app.prisma.$transaction(async tx => {
      const playbook = await tx.playbook.findFirst({ where: { id, workspaceId: request.auth.workspaceId }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
      if (!playbook) throw new DomainError('NOT_FOUND', 'Automação não encontrada.', 404);
      if (playbook.status === 'ARCHIVED') throw new DomainError('PLAYBOOK_ARCHIVED', 'Fluxo arquivado não pode ser publicado. Desarquive primeiro.', 409);
      const latest = playbook.versions[0];
      if (!latest || latest.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT', 'Somente a versão mais recente pode ser publicada.', 409, { currentVersion: latest?.version ?? 0 });
      const validation = await validateForWorkspace(tx,request.auth.workspaceId,latest.definition);
      if (!validation.valid) throw new DomainError('INVALID_AUTOMATION', 'A versão possui erros e não pode ser publicada.', 422, validation.issues);
      const persistedChecksum = checksum(latest.definition);
      const validatedChecksum = checksum(validation.definition);
      if (persistedChecksum !== validatedChecksum) throw new DomainError('CHECKSUM_MISMATCH', 'A integridade da versão não pôde ser confirmada.', 409);
      // Versions created before canonical checksums used JSON.stringify directly.
      // Repair them lazily after proving that validation preserved the definition.
      if (latest.checksum !== persistedChecksum) await tx.playbookVersion.update({ where: { id: latest.id }, data: { checksum: persistedChecksum } });
      if (playbook.activeVersionId === latest.id && playbook.status === 'PUBLISHED') return playbook;
      if (playbook.activeVersionId !== latest.id) await tx.playbookVersion.update({ where: { id: latest.id }, data: { publishedAt: new Date() } });
      const published = await tx.playbook.update({ where: { id }, data: { activeVersionId: latest.id, status: 'PUBLISHED' }, include: { activeVersion: true } });
      await audit(tx, { workspaceId: request.auth.workspaceId, actorId: request.auth.userId, action: 'playbook.published', targetType: 'Playbook', targetId: id, changes: { version: input.expectedVersion, testCaseIds: input.testCaseIds } });
      return published;
    }, { isolationLevel: 'Serializable' });
  });

  app.post('/v1/playbooks/:id/executions', { preHandler: [app.requirePermission('playbook.write')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = StartPlaybookExecutionInput.parse(request.body);
    await assertWorkspaceQuota(app.prisma, request.auth.workspaceId, 'executionsMonthly');
    const result = await app.prisma.$transaction(async tx => {
      const playbook = await tx.playbook.findFirst({ where: { id, workspaceId: request.auth.workspaceId }, include: { activeVersion: true } });
      if (!playbook) throw new DomainError('NOT_FOUND', 'Automação não encontrada.', 404);
      if (!playbook.activeVersion) throw new DomainError('PLAYBOOK_NOT_PUBLISHED', 'Publique a automação antes de executá-la.', 409);
      if (playbook.status === 'ARCHIVED') throw new DomainError('PLAYBOOK_ARCHIVED', 'A automação está arquivada.', 409);
      if (playbook.status === 'PAUSED') throw new DomainError('PLAYBOOK_NOT_PUBLISHED', 'A automação está pausada.', 409);
      const conversation = await tx.conversation.findFirst({ where: { id: input.conversationId, workspaceId: request.auth.workspaceId } });
      if (!conversation) throw new DomainError('CONVERSATION_NOT_FOUND', 'Conversa não encontrada.', 404);
      const running = await tx.execution.findFirst({ where: { workspaceId: request.auth.workspaceId, conversationId: input.conversationId, playbookVersionId: playbook.activeVersion.id, status: { in: ['RUNNING', 'WAITING'] } } });
      if (running) throw new DomainError('EXECUTION_ALREADY_ACTIVE', 'Já existe uma execução ativa desta automação na conversa.', 409, { executionId: running.id });
      const execution = await tx.execution.create({ data: { workspaceId: request.auth.workspaceId, conversationId: input.conversationId, playbookVersionId: playbook.activeVersion.id, currentNode: null, context: json(input.context) } });
      await enqueue(tx, { workspaceId: request.auth.workspaceId, aggregate: 'Execution', aggregateId: execution.id, type: 'automation.execution.requested', payload: { executionId: execution.id } });
      await audit(tx, { workspaceId: request.auth.workspaceId, actorId: request.auth.userId, action: 'playbook.execution_requested', targetType: 'Execution', targetId: execution.id, changes: { playbookId: id, conversationId: input.conversationId } });
      return execution;
    });
    return reply.status(202).send(result);
  });

  app.get('/v1/playbooks/:id/executions', { preHandler: [app.requirePermission('playbook.read')] }, async request => {
    const { id } = request.params as { id: string };
    const query = ListExecutionsQuery.parse(request.query);
    if (!await app.prisma.playbook.count({ where: { id, workspaceId: request.auth.workspaceId } })) throw new DomainError('NOT_FOUND', 'Automação não encontrada.', 404);
    return app.prisma.execution.findMany({ where: { workspaceId: request.auth.workspaceId, playbookVersion: { playbookId: id }, conversationId: query.conversationId, status: query.status }, include: { playbookVersion: { select: { version: true } }, _count: { select: { steps: true } } }, orderBy: { startedAt: 'desc' }, take: query.limit });
  });

  app.get('/v1/executions/:executionId', { preHandler: [app.requirePermission('playbook.read')] }, async request => {
    const { executionId } = request.params as { executionId: string };
    const execution = await app.prisma.execution.findFirst({ where: { id: executionId, workspaceId: request.auth.workspaceId }, include: { steps: { orderBy: { startedAt: 'asc' } }, playbookVersion: { select: { version: true, playbook: { select: { id: true, name: true } } } }, conversation: { select: { id: true, contact: { select: { id: true, name: true, phone: true } } } } } });
    if (!execution) throw new DomainError('EXECUTION_NOT_FOUND', 'Execução não encontrada.', 404);
    return execution;
  });

  app.post('/v1/executions/:executionId/cancel', { preHandler: [app.requirePermission('playbook.write')] }, async request => {
    const { executionId } = request.params as { executionId: string };
    const result = await app.prisma.$transaction(async tx => {
      const execution = await tx.execution.findFirst({ where: { id: executionId, workspaceId: request.auth.workspaceId } });
      if (!execution) throw new DomainError('EXECUTION_NOT_FOUND', 'Execução não encontrada.', 404);
      if (!['RUNNING', 'WAITING'].includes(execution.status)) throw new DomainError('EXECUTION_NOT_ACTIVE', 'A execução não está ativa.', 409);
      const cancelled = await tx.execution.update({ where: { id: executionId }, data: { status: 'CANCELLED', finishedAt: new Date() } });
      await enqueue(tx, { workspaceId: request.auth.workspaceId, aggregate: 'Execution', aggregateId: executionId, type: 'automation.execution.cancelled', payload: { executionId } });
      await audit(tx, { workspaceId: request.auth.workspaceId, actorId: request.auth.userId, action: 'playbook.execution_cancelled', targetType: 'Execution', targetId: executionId });
      return cancelled;
    });
    return result;
  });
};
