-- Disparos em massa, com opt-in obrigatório e lista de saída.
CREATE TYPE "BroadcastStatus" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'DONE', 'CANCELLED');
CREATE TYPE "BroadcastRecipientStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED');

-- Lista de saída: contato que pediu para sair nunca volta a entrar num disparo.
ALTER TABLE "Contact" ADD COLUMN "optedOutAt" TIMESTAMP(3);
CREATE INDEX "Contact_workspaceId_optedOutAt_idx" ON "Contact"("workspaceId", "optedOutAt");

CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "BroadcastStatus" NOT NULL DEFAULT 'DRAFT',
    "minIntervalSeconds" INTEGER NOT NULL DEFAULT 45,
    "maxIntervalSeconds" INTEGER NOT NULL DEFAULT 180,
    "dailyQuota" INTEGER NOT NULL DEFAULT 200,
    "startAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BroadcastRecipient" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "BroadcastRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "messageId" TEXT,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "BroadcastRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Broadcast_workspaceId_status_createdAt_idx" ON "Broadcast"("workspaceId", "status", "createdAt");
-- Um contato só entra uma vez no mesmo disparo, mesmo que dois filtros o selecionem.
CREATE UNIQUE INDEX "BroadcastRecipient_broadcastId_contactId_key" ON "BroadcastRecipient"("broadcastId", "contactId");
CREATE INDEX "BroadcastRecipient_broadcastId_status_scheduledFor_idx" ON "BroadcastRecipient"("broadcastId", "status", "scheduledFor");

ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
