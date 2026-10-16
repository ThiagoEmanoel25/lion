CREATE TABLE "FlowImportSession" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'leona',
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "playbookId" TEXT,
    "report" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FlowImportSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FlowImportSession_code_key" ON "FlowImportSession"("code");
CREATE INDEX "FlowImportSession_workspaceId_createdAt_idx" ON "FlowImportSession"("workspaceId", "createdAt");
CREATE INDEX "FlowImportSession_expiresAt_status_idx" ON "FlowImportSession"("expiresAt", "status");

CREATE TABLE "FlowShareCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "playbookId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "sourceName" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FlowShareCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FlowShareCode_code_key" ON "FlowShareCode"("code");
CREATE INDEX "FlowShareCode_workspaceId_playbookId_createdAt_idx" ON "FlowShareCode"("workspaceId", "playbookId", "createdAt");
CREATE INDEX "FlowShareCode_expiresAt_revokedAt_idx" ON "FlowShareCode"("expiresAt", "revokedAt");

ALTER TABLE "FlowImportSession" ADD CONSTRAINT "FlowImportSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FlowImportSession" ADD CONSTRAINT "FlowImportSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FlowImportSession" ADD CONSTRAINT "FlowImportSession_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "Playbook"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FlowShareCode" ADD CONSTRAINT "FlowShareCode_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FlowShareCode" ADD CONSTRAINT "FlowShareCode_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "Playbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FlowShareCode" ADD CONSTRAINT "FlowShareCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
