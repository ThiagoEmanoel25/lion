CREATE TYPE "ScheduledMessageStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'CANCELLED', 'FAILED');

ALTER TABLE "Conversation"
  ADD COLUMN "lastInboundAt" TIMESTAMP(3),
  ADD COLUMN "lastOutboundAt" TIMESTAMP(3),
  ADD COLUMN "needsReply" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Conversation" c
SET
  "lastInboundAt" = source."lastInboundAt",
  "lastOutboundAt" = source."lastOutboundAt"
FROM (
  SELECT
    "conversationId",
    MAX("createdAt") FILTER (WHERE "direction" = 'INBOUND') AS "lastInboundAt",
    MAX("createdAt") FILTER (WHERE "direction" = 'OUTBOUND') AS "lastOutboundAt"
  FROM "Message"
  GROUP BY "conversationId"
) source
WHERE source."conversationId" = c."id";

UPDATE "Conversation" SET "needsReply" = "lastInboundAt" IS NOT NULL AND ("lastOutboundAt" IS NULL OR "lastInboundAt" > "lastOutboundAt");

CREATE INDEX "Conversation_workspaceId_lastInboundAt_idx" ON "Conversation"("workspaceId", "lastInboundAt");
CREATE INDEX "Conversation_workspaceId_lastOutboundAt_idx" ON "Conversation"("workspaceId", "lastOutboundAt");
CREATE INDEX "Conversation_workspaceId_needsReply_status_idx" ON "Conversation"("workspaceId", "needsReply", "status");

CREATE TABLE "QuickReply" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "shortcut" TEXT NOT NULL,
  "shortcutNormalized" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "assetId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QuickReply_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GlobalVariable" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "valueEncrypted" TEXT NOT NULL,
  "valueLast4" TEXT,
  "sensitive" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GlobalVariable_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScheduledMessage" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "status" "ScheduledMessageStatus" NOT NULL DEFAULT 'PENDING',
  "sentMessageId" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScheduledMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuickReply_workspaceId_shortcutNormalized_key" ON "QuickReply"("workspaceId", "shortcutNormalized");
CREATE INDEX "QuickReply_workspaceId_updatedAt_idx" ON "QuickReply"("workspaceId", "updatedAt");
CREATE UNIQUE INDEX "GlobalVariable_workspaceId_normalizedName_key" ON "GlobalVariable"("workspaceId", "normalizedName");
CREATE INDEX "GlobalVariable_workspaceId_updatedAt_idx" ON "GlobalVariable"("workspaceId", "updatedAt");
CREATE UNIQUE INDEX "ScheduledMessage_sentMessageId_key" ON "ScheduledMessage"("sentMessageId");
CREATE INDEX "ScheduledMessage_workspaceId_status_scheduledFor_idx" ON "ScheduledMessage"("workspaceId", "status", "scheduledFor");
CREATE INDEX "ScheduledMessage_conversationId_status_scheduledFor_idx" ON "ScheduledMessage"("conversationId", "status", "scheduledFor");

ALTER TABLE "QuickReply" ADD CONSTRAINT "QuickReply_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuickReply" ADD CONSTRAINT "QuickReply_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "PlaybookAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GlobalVariable" ADD CONSTRAINT "GlobalVariable_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_sentMessageId_fkey" FOREIGN KEY ("sentMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION nexo_touch_conversation_message_time()
RETURNS trigger AS $$
BEGIN
  IF NEW."direction" = 'INBOUND' THEN
    UPDATE "Conversation" SET "lastInboundAt" = NEW."createdAt", "needsReply" = true, "updatedAt" = GREATEST("updatedAt", NEW."createdAt") WHERE "id" = NEW."conversationId";
  ELSE
    UPDATE "Conversation" SET "lastOutboundAt" = NEW."createdAt", "needsReply" = false, "updatedAt" = GREATEST("updatedAt", NEW."createdAt") WHERE "id" = NEW."conversationId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Message_touch_conversation_time"
AFTER INSERT ON "Message"
FOR EACH ROW EXECUTE FUNCTION nexo_touch_conversation_message_time();
