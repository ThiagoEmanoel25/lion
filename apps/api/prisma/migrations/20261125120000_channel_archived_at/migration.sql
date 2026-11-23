-- Remover número = arquivar o canal (soft delete): preserva conversas e mensagens.
ALTER TABLE "Channel" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "Channel_workspaceId_archivedAt_idx" ON "Channel"("workspaceId", "archivedAt");
