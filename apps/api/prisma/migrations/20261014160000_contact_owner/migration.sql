-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "ownerId" TEXT;

-- CreateIndex
CREATE INDEX "Contact_workspaceId_ownerId_updatedAt_idx" ON "Contact"("workspaceId", "ownerId", "updatedAt");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
