CREATE TYPE "ChannelFlowSlot" AS ENUM ('WELCOME', 'DEFAULT_RESPONSE', 'CONVERSATION_RESOLVED', 'HANDOFF_CLOSED');
CREATE TYPE "ChannelKeywordMatch" AS ENUM ('EXACT', 'CONTAINS');

CREATE TABLE "ChannelFlowConfig" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "slot" "ChannelFlowSlot" NOT NULL,
    "playbookId" TEXT NOT NULL,
    "windowHours" INTEGER NOT NULL DEFAULT 24,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChannelFlowConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChannelKeyword" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "normalizedKeyword" TEXT NOT NULL,
    "match" "ChannelKeywordMatch" NOT NULL,
    "playbookId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChannelKeyword_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelFlowConfig_channelId_slot_key" ON "ChannelFlowConfig"("channelId", "slot");
CREATE INDEX "ChannelFlowConfig_playbookId_idx" ON "ChannelFlowConfig"("playbookId");
CREATE UNIQUE INDEX "ChannelKeyword_channelId_normalizedKeyword_match_key" ON "ChannelKeyword"("channelId", "normalizedKeyword", "match");
CREATE INDEX "ChannelKeyword_channelId_createdAt_idx" ON "ChannelKeyword"("channelId", "createdAt");
CREATE INDEX "ChannelKeyword_playbookId_idx" ON "ChannelKeyword"("playbookId");

ALTER TABLE "ChannelFlowConfig" ADD CONSTRAINT "ChannelFlowConfig_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelFlowConfig" ADD CONSTRAINT "ChannelFlowConfig_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "Playbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelKeyword" ADD CONSTRAINT "ChannelKeyword_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelKeyword" ADD CONSTRAINT "ChannelKeyword_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "Playbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ChannelFlowConfig" ("id", "channelId", "slot", "playbookId", "windowHours")
SELECT 'legacy_' || md5("id"), "id", 'WELCOME'::"ChannelFlowSlot", "activePlaybookId", 24
FROM "Channel"
WHERE "activePlaybookId" IS NOT NULL
ON CONFLICT ("channelId", "slot") DO NOTHING;
