CREATE TABLE "KanbanBoard" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KanbanBoard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KanbanColumn" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#17765b',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KanbanColumn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KanbanCard" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "columnId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "movedByType" TEXT NOT NULL,
    "movedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KanbanCard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KanbanCardEvent" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "fromColumnId" TEXT,
    "toColumnId" TEXT,
    "movedByType" TEXT NOT NULL,
    "movedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KanbanCardEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KanbanBoard_workspaceId_name_key" ON "KanbanBoard"("workspaceId", "name");
CREATE INDEX "KanbanBoard_workspaceId_position_idx" ON "KanbanBoard"("workspaceId", "position");
CREATE UNIQUE INDEX "KanbanColumn_boardId_name_key" ON "KanbanColumn"("boardId", "name");
CREATE INDEX "KanbanColumn_boardId_position_idx" ON "KanbanColumn"("boardId", "position");
CREATE UNIQUE INDEX "KanbanCard_boardId_contactId_key" ON "KanbanCard"("boardId", "contactId");
CREATE INDEX "KanbanCard_columnId_position_idx" ON "KanbanCard"("columnId", "position");
CREATE INDEX "KanbanCard_conversationId_idx" ON "KanbanCard"("conversationId");
CREATE INDEX "KanbanCardEvent_cardId_createdAt_idx" ON "KanbanCardEvent"("cardId", "createdAt");
CREATE INDEX "KanbanCardEvent_toColumnId_createdAt_idx" ON "KanbanCardEvent"("toColumnId", "createdAt");

ALTER TABLE "KanbanBoard" ADD CONSTRAINT "KanbanBoard_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanColumn" ADD CONSTRAINT "KanbanColumn_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "KanbanBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanCard" ADD CONSTRAINT "KanbanCard_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "KanbanBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanCard" ADD CONSTRAINT "KanbanCard_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "KanbanColumn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KanbanCard" ADD CONSTRAINT "KanbanCard_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanCard" ADD CONSTRAINT "KanbanCard_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KanbanCardEvent" ADD CONSTRAINT "KanbanCardEvent_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "KanbanCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanCardEvent" ADD CONSTRAINT "KanbanCardEvent_fromColumnId_fkey" FOREIGN KEY ("fromColumnId") REFERENCES "KanbanColumn"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KanbanCardEvent" ADD CONSTRAINT "KanbanCardEvent_toColumnId_fkey" FOREIGN KEY ("toColumnId") REFERENCES "KanbanColumn"("id") ON DELETE SET NULL ON UPDATE CASCADE;
