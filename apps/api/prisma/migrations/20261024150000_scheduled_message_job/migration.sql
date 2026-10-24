ALTER TABLE "ScheduledMessage" ADD COLUMN "jobId" TEXT;
CREATE UNIQUE INDEX "ScheduledMessage_jobId_key" ON "ScheduledMessage"("jobId");
