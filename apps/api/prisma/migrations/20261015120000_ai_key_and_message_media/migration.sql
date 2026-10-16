ALTER TABLE "Workspace" ADD COLUMN "openaiApiKeyEncrypted" TEXT,
ADD COLUMN "openaiApiKeyLast4" TEXT;

CREATE TABLE "MessageMedia" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileName" TEXT,
    "size" INTEGER NOT NULL,
    "data" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageMedia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageMedia_messageId_key" ON "MessageMedia"("messageId");
CREATE INDEX "MessageMedia_createdAt_idx" ON "MessageMedia"("createdAt");
ALTER TABLE "MessageMedia" ADD CONSTRAINT "MessageMedia_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
