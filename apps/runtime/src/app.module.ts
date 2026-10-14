import { Module } from '@nestjs/common';
import { PrismaService } from './infra/prisma.service.js';
import { RedisService } from './infra/redis.service.js';
import { RuntimeWorkers } from './runtime-workers.service.js';
import { AuthStateStore } from './whatsapp/auth-state.store.js';
import { WhatsAppSessionManager } from './whatsapp/session-manager.service.js';
import { AutomationEngineService } from './automation/automation-engine.service.js';
import { KnowledgeIndexerService } from './knowledge/knowledge-indexer.service.js';
import { AgentRuntimeService } from './agent/agent-runtime.service.js';

@Module({
  providers: [PrismaService, RedisService, AuthStateStore, WhatsAppSessionManager, AgentRuntimeService, AutomationEngineService, KnowledgeIndexerService, RuntimeWorkers]
})
export class AppModule {}
