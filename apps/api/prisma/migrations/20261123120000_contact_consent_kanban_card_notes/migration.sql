-- Trilha de consentimento (LGPD) e título/nota do cartão. Só colunas nulas: retrocompatível.
ALTER TABLE "Contact" ADD COLUMN "consentSource" TEXT,
ADD COLUMN "consentById" TEXT,
ADD COLUMN "consentRevokedAt" TIMESTAMP(3);

ALTER TABLE "KanbanCard" ADD COLUMN "title" TEXT,
ADD COLUMN "note" TEXT;
