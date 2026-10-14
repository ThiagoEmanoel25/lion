-- Message command idempotency key is intentionally separate from the provider message id.
ALTER TABLE "Message" ADD COLUMN "clientRequestId" TEXT;

CREATE UNIQUE INDEX "Message_workspaceId_clientRequestId_key"
ON "Message"("workspaceId", "clientRequestId");

CREATE TABLE "WhatsAppAuthState" (
    "channelId" TEXT NOT NULL,
    "encryptedCreds" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsAppAuthState_pkey" PRIMARY KEY ("channelId")
);

CREATE TABLE "WhatsAppAuthKey" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsAppAuthKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppAuthKey_channelId_category_keyId_key"
ON "WhatsAppAuthKey"("channelId", "category", "keyId");

CREATE INDEX "WhatsAppAuthKey_channelId_category_idx"
ON "WhatsAppAuthKey"("channelId", "category");

ALTER TABLE "WhatsAppAuthState"
ADD CONSTRAINT "WhatsAppAuthState_channelId_fkey"
FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WhatsAppAuthKey"
ADD CONSTRAINT "WhatsAppAuthKey_channelId_fkey"
FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
