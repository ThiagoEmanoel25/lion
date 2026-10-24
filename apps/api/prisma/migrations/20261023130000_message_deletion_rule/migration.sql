-- Apagar mensagem ao aplicar etiqueta (paridade com o Leona).
CREATE TYPE "MessageDeletionStatus" AS ENUM ('PENDING', 'REQUESTED', 'DELETED', 'FAILED');

CREATE TABLE "MessageDeletionRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "status" "MessageDeletionStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageDeletionRule_pkey" PRIMARY KEY ("id")
);

-- Uma mensagem só tem uma regra por etiqueta: é o que torna o disparo idempotente.
CREATE UNIQUE INDEX "MessageDeletionRule_messageId_tagId_key" ON "MessageDeletionRule"("messageId", "tagId");
CREATE INDEX "MessageDeletionRule_contactId_tagId_status_idx" ON "MessageDeletionRule"("contactId", "tagId", "status");

ALTER TABLE "MessageDeletionRule" ADD CONSTRAINT "MessageDeletionRule_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
