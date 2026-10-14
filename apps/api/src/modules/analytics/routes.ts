import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { buildDailySeries, percentageChange, ratio, startOfUtcDay } from './metrics.js';

const Query = z.object({ days: z.coerce.number().int().refine(value => [7, 30, 90].includes(value)).default(7) });

const attentionReason = (conversation: { mode: string; status: string; unreadCount: number; assigneeId: string | null }) => {
  if (conversation.mode === 'HUMAN' && !conversation.assigneeId) return 'Aguardando responsável';
  if (conversation.status === 'QUEUED') return 'Na fila de atendimento';
  if (conversation.unreadCount > 0) return `${conversation.unreadCount} mensagem${conversation.unreadCount > 1 ? 'ens' : ''} não lida${conversation.unreadCount > 1 ? 's' : ''}`;
  return 'Revisão humana recomendada';
};

export const analyticsRoutes: FastifyPluginAsync = async app => {
  app.get('/v1/analytics/overview', { preHandler: [app.requirePermission('analytics.read')] }, async request => {
    const { days } = Query.parse(request.query);
    const workspaceId = request.auth.workspaceId;
    const to = new Date();
    const from = startOfUtcDay(to);
    from.setUTCDate(from.getUTCDate() - days + 1);
    const previousFrom = new Date(from);
    previousFrom.setUTCDate(previousFrom.getUTCDate() - days);

    const [conversations, previousConversations, outcomes, previousOutcomes, usage, previousUsage, open, firstResponses, automatedResolved, failedExecutions, channels, attention, playbooks] = await Promise.all([
      app.prisma.conversation.findMany({ where: { workspaceId, OR: [{ createdAt: { gte: from, lte: to } }, { resolvedAt: { gte: from, lte: to } }] }, select: { createdAt: true, resolvedAt: true } }),
      app.prisma.conversation.count({ where: { workspaceId, createdAt: { gte: previousFrom, lt: from } } }),
      app.prisma.outcome.findMany({ where: { workspaceId, occurredAt: { gte: from, lte: to } }, select: { occurredAt: true, type: true, conversationId: true } }),
      app.prisma.outcome.count({ where: { workspaceId, occurredAt: { gte: previousFrom, lt: from } } }),
      app.prisma.usageRecord.aggregate({ where: { workspaceId, occurredAt: { gte: from, lte: to } }, _sum: { costCents: true } }),
      app.prisma.usageRecord.aggregate({ where: { workspaceId, occurredAt: { gte: previousFrom, lt: from } }, _sum: { costCents: true } }),
      app.prisma.conversation.count({ where: { workspaceId, status: { not: 'RESOLVED' } } }),
      app.prisma.conversation.findMany({ where: { workspaceId, createdAt: { gte: from, lte: to }, firstResponseAt: { not: null } }, select: { createdAt: true, firstResponseAt: true } }),
      app.prisma.conversation.count({ where: { workspaceId, resolvedAt: { gte: from, lte: to }, mode: { not: 'HUMAN' }, executions: { some: { status: 'SUCCEEDED' } } } }),
      app.prisma.execution.count({ where: { workspaceId, startedAt: { gte: from, lte: to }, status: 'FAILED' } }),
      app.prisma.channel.groupBy({ by: ['status'], where: { workspaceId }, _count: { _all: true } }),
      app.prisma.conversation.findMany({
        where: { workspaceId, status: { not: 'RESOLVED' }, OR: [{ status: 'QUEUED' }, { mode: 'HUMAN' }, { unreadCount: { gt: 0 } }] },
        select: { id: true, status: true, mode: true, unreadCount: true, assigneeId: true, updatedAt: true, contact: { select: { id: true, name: true, phone: true } } },
        orderBy: [{ unreadCount: 'desc' }, { updatedAt: 'asc' }], take: 5
      }),
      app.prisma.playbook.findMany({
        where: { workspaceId, status: 'PUBLISHED', activeVersionId: { not: null } },
        select: { id: true, name: true, activeVersion: { select: { version: true, executions: { where: { startedAt: { gte: from, lte: to } }, select: { status: true } } } } },
        orderBy: { updatedAt: 'desc' }, take: 5
      })
    ]);

    const conversationCount = conversations.filter(item => item.createdAt >= from && item.createdAt <= to).length;
    const outcomeCount = outcomes.length;
    const convertedConversations = new Set(outcomes.map(item => item.conversationId)).size;
    const resolved = conversations.filter(item => item.resolvedAt && item.resolvedAt >= from && item.resolvedAt <= to).length;
    const costCents = usage._sum.costCents ?? 0;
    const previousCostCents = previousUsage._sum.costCents ?? 0;
    const responseValues = firstResponses.flatMap(item => item.firstResponseAt ? [(item.firstResponseAt.getTime() - item.createdAt.getTime()) / 1000] : []);
    const averageFirstResponseSeconds = responseValues.length ? Math.round(responseValues.reduce((sum, value) => sum + value, 0) / responseValues.length) : null;
    const totalChannels = channels.reduce((sum, item) => sum + item._count._all, 0);
    const connectedChannels = channels.find(item => item.status === 'CONNECTED')?._count._all ?? 0;
    const degradedChannels = totalChannels - connectedChannels;
    const healthScore = Math.max(0, Math.round(100 - (totalChannels ? degradedChannels / totalChannels * 45 : 15) - Math.min(failedExecutions * 5, 30) - Math.min(open / 20, 10)));
    const aiResolutionRate = ratio(automatedResolved, resolved);
    const outcomeRate = ratio(convertedConversations, conversationCount);

    return {
      period: { from: from.toISOString(), to: to.toISOString(), days },
      summary: {
        conversations: conversationCount, outcomes: outcomeCount, open, resolved, costCents,
        outcomeRate, aiResolutionRate, averageFirstResponseSeconds,
        costPerOutcomeCents: outcomeCount ? Math.round(costCents / outcomeCount) : null,
        trends: {
          conversations: percentageChange(conversationCount, previousConversations),
          outcomes: percentageChange(outcomeCount, previousOutcomes),
          cost: percentageChange(costCents, previousCostCents)
        }
      },
      series: buildDailySeries(from, days, conversations, outcomes),
      health: {
        score: healthScore,
        label: healthScore >= 90 ? 'Excelente' : healthScore >= 75 ? 'Estável' : healthScore >= 55 ? 'Atenção' : 'Crítica',
        signals: [
          { key: 'channels', label: 'Canais de atendimento', status: totalChannels === 0 ? 'warning' : degradedChannels > 0 ? 'warning' : 'operational', detail: totalChannels === 0 ? 'Nenhum canal configurado' : degradedChannels > 0 ? `${degradedChannels} requer atenção` : `${connectedChannels} operacional${connectedChannels === 1 ? '' : 'is'}` },
          { key: 'automations', label: 'Automações', status: failedExecutions > 0 ? 'warning' : 'operational', detail: failedExecutions > 0 ? `${failedExecutions} falha${failedExecutions === 1 ? '' : 's'} no período` : 'Sem falhas no período' },
          { key: 'service', label: 'Fila de atendimento', status: attention.length > 0 ? 'warning' : 'operational', detail: attention.length > 0 ? `${attention.length} conversa${attention.length === 1 ? '' : 's'} em atenção` : 'Sem pendências prioritárias' }
        ]
      },
      attention: attention.map(item => ({ id: item.id, contact: item.contact, reason: attentionReason(item), updatedAt: item.updatedAt.toISOString() })),
      playbooks: playbooks.map(item => {
        const executions = item.activeVersion?.executions ?? [];
        const succeeded = executions.filter(execution => execution.status === 'SUCCEEDED').length;
        const failed = executions.filter(execution => execution.status === 'FAILED').length;
        return { id: item.id, name: item.name, version: item.activeVersion?.version ?? 0, executions: executions.length, succeeded, failed, successRate: ratio(succeeded, executions.length) };
      }),
      insight: conversationCount === 0 ? null : outcomeRate >= .5
        ? { tone: 'positive', title: 'Boa conversão no período', message: `${Math.round(outcomeRate * 100)}% das novas conversas geraram um desfecho registrado.` }
        : { tone: 'opportunity', title: 'Oportunidade de conversão', message: `${Math.max(0, conversationCount - convertedConversations)} conversa${conversationCount - convertedConversations === 1 ? '' : 's'} ainda não geraram desfecho no período.` }
    };
  });
};
