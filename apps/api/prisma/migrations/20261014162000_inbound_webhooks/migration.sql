CREATE TABLE "InboundWebhookEndpoint" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "playbookId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "secretHint" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InboundWebhookEndpoint_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "RawWebhookEvent" ADD COLUMN "webhookEndpointId" TEXT;
ALTER TABLE "RawWebhookEvent" ADD COLUMN "replayedFromId" TEXT;
ALTER TABLE "RawWebhookEvent" ADD COLUMN "executionId" TEXT;
CREATE UNIQUE INDEX "InboundWebhookEndpoint_publicId_key" ON "InboundWebhookEndpoint"("publicId");
CREATE INDEX "InboundWebhookEndpoint_workspaceId_isActive_idx" ON "InboundWebhookEndpoint"("workspaceId", "isActive");
CREATE INDEX "InboundWebhookEndpoint_playbookId_idx" ON "InboundWebhookEndpoint"("playbookId");
CREATE INDEX "InboundWebhookEndpoint_channelId_idx" ON "InboundWebhookEndpoint"("channelId");
CREATE UNIQUE INDEX "RawWebhookEvent_webhookEndpointId_externalId_key" ON "RawWebhookEvent"("webhookEndpointId", "externalId");
CREATE INDEX "RawWebhookEvent_webhookEndpointId_receivedAt_idx" ON "RawWebhookEvent"("webhookEndpointId", "receivedAt");
ALTER TABLE "InboundWebhookEndpoint" ADD CONSTRAINT "InboundWebhookEndpoint_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboundWebhookEndpoint" ADD CONSTRAINT "InboundWebhookEndpoint_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "Playbook"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InboundWebhookEndpoint" ADD CONSTRAINT "InboundWebhookEndpoint_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RawWebhookEvent" ADD CONSTRAINT "RawWebhookEvent_webhookEndpointId_fkey" FOREIGN KEY ("webhookEndpointId") REFERENCES "InboundWebhookEndpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
