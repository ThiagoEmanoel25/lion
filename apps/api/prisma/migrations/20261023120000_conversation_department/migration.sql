-- Departamento deixa de ser texto livre: a conversa passa a apontar para o cadastro.
-- "queue" continua como retrato do nome no momento da atribuição, para compatibilidade.
ALTER TABLE "Conversation" ADD COLUMN "departmentId" TEXT;

CREATE INDEX "Conversation_departmentId_idx" ON "Conversation"("departmentId");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Associa pelo nome só quando houver um único departamento ativo correspondente, ignorando caixa.
-- Nome ambíguo ou inexistente mantém apenas o texto em "queue".
UPDATE "Conversation" c SET "departmentId" = d.id
FROM "Department" d
WHERE d."workspaceId" = c."workspaceId"
  AND c.queue IS NOT NULL
  AND lower(d.name) = lower(c.queue)
  AND d."isActive"
  AND (SELECT count(*) FROM "Department" x
       WHERE x."workspaceId" = c."workspaceId" AND lower(x.name) = lower(c.queue) AND x."isActive") = 1;
