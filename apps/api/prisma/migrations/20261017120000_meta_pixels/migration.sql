CREATE TABLE "MetaPixel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pixelId" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "accessTokenLast4" TEXT NOT NULL,
    "pageId" TEXT,
    "testEventCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MetaPixel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetaPixel_workspaceId_name_key" ON "MetaPixel"("workspaceId", "name");

ALTER TABLE "MetaPixel" ADD CONSTRAINT "MetaPixel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
