CREATE TABLE "PlaybookAsset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaybookAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlaybookAsset_workspaceId_createdAt_idx" ON "PlaybookAsset"("workspaceId", "createdAt");

ALTER TABLE "PlaybookAsset" ADD CONSTRAINT "PlaybookAsset_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
