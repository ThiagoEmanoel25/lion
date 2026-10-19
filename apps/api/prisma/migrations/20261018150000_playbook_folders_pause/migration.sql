ALTER TYPE "PlaybookStatus" ADD VALUE 'PAUSED';

CREATE TABLE "PlaybookFolder" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlaybookFolder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlaybookFolder_workspaceId_name_key" ON "PlaybookFolder"("workspaceId", "name");

ALTER TABLE "PlaybookFolder" ADD CONSTRAINT "PlaybookFolder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Playbook" ADD COLUMN "folderId" TEXT;

CREATE INDEX "Playbook_folderId_idx" ON "Playbook"("folderId");

ALTER TABLE "Playbook" ADD CONSTRAINT "Playbook_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "PlaybookFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
