ALTER TABLE "Channel" ADD COLUMN "activePlaybookId" TEXT;

CREATE INDEX "Channel_workspaceId_activePlaybookId_idx"
ON "Channel"("workspaceId", "activePlaybookId");

ALTER TABLE "Channel"
ADD CONSTRAINT "Channel_activePlaybookId_fkey"
FOREIGN KEY ("activePlaybookId") REFERENCES "Playbook"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
