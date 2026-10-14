CREATE TABLE "AiAgent" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'openai',
  "model" TEXT NOT NULL,
  "objective" TEXT NOT NULL,
  "systemPrompt" TEXT NOT NULL,
  "tone" TEXT NOT NULL DEFAULT 'professional',
  "confidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
  "handoffMessage" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiAgent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentKnowledgeSource" (
  "agentId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  CONSTRAINT "AgentKnowledgeSource_pkey" PRIMARY KEY ("agentId", "sourceId")
);

CREATE INDEX "AiAgent_workspaceId_isActive_updatedAt_idx" ON "AiAgent"("workspaceId", "isActive", "updatedAt");
CREATE INDEX "AgentKnowledgeSource_sourceId_idx" ON "AgentKnowledgeSource"("sourceId");
ALTER TABLE "AiAgent" ADD CONSTRAINT "AiAgent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentKnowledgeSource" ADD CONSTRAINT "AgentKnowledgeSource_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentKnowledgeSource" ADD CONSTRAINT "AgentKnowledgeSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
