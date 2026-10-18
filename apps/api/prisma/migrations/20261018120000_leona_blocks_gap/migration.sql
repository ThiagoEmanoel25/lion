ALTER TABLE "Playbook" ADD COLUMN "importSource" JSONB;

CREATE TABLE "FlowDistributorCount" (
  "id" TEXT NOT NULL,
  "playbookId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "outputId" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FlowDistributorCount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FlowDistributorAssignment" (
  "id" TEXT NOT NULL,
  "playbookId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "outputId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FlowDistributorAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FlowDistributorCount_playbookId_nodeId_outputId_key" ON "FlowDistributorCount"("playbookId", "nodeId", "outputId");
CREATE INDEX "FlowDistributorCount_playbookId_nodeId_idx" ON "FlowDistributorCount"("playbookId", "nodeId");
CREATE UNIQUE INDEX "FlowDistributorAssignment_playbookId_nodeId_contactId_key" ON "FlowDistributorAssignment"("playbookId", "nodeId", "contactId");
CREATE INDEX "FlowDistributorAssignment_playbookId_nodeId_outputId_idx" ON "FlowDistributorAssignment"("playbookId", "nodeId", "outputId");
ALTER TABLE "FlowDistributorCount" ADD CONSTRAINT "FlowDistributorCount_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "Playbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FlowDistributorAssignment" ADD CONSTRAINT "FlowDistributorAssignment_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "Playbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FlowDistributorAssignment" ADD CONSTRAINT "FlowDistributorAssignment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
