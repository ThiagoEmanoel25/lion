-- Aditiva e retrocompatível: colunas nulas; sessões legadas tratam familyId nulo como a própria sessão.
ALTER TABLE "Session" ADD COLUMN "familyId" TEXT;
ALTER TABLE "Session" ADD COLUMN "workspaceId" TEXT;
UPDATE "Session" SET "familyId" = "id" WHERE "familyId" IS NULL;
CREATE INDEX "Session_familyId_idx" ON "Session"("familyId");
