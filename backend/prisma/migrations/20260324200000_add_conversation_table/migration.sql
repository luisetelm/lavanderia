-- 1. Crear tabla Conversation
CREATE TABLE "Conversation" (
    "id"            SERIAL PRIMARY KEY,
    "clientId"      INT REFERENCES "User"("id"),
    "phone"         TEXT NOT NULL,
    "lastMessageAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "unreadCount"   INT NOT NULL DEFAULT 0,
    "createdAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updatedAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "Conversation_clientId_phone_key" ON "Conversation"("clientId", "phone");

-- 2. Añadir columna conversationId a Message y Notification
ALTER TABLE "Message" ADD COLUMN "conversationId" INT;
ALTER TABLE "Notification" ADD COLUMN "conversationId" INT;

-- 3. Poblar Conversation desde mensajes existentes (clientes conocidos)
INSERT INTO "Conversation" ("clientId", "phone", "lastMessageAt", "unreadCount", "createdAt")
SELECT
    m."clientId",
    COALESCE(u."phone", m."phone"),
    MAX(m."createdAt"),
    COALESCE(SUM(CASE WHEN m."direction" = 'inbound' AND m."status" = 'received' THEN 1 ELSE 0 END)::int, 0),
    MIN(m."createdAt")
FROM "Message" m
LEFT JOIN "User" u ON u."id" = m."clientId"
WHERE m."clientId" IS NOT NULL
GROUP BY m."clientId", COALESCE(u."phone", m."phone")
ON CONFLICT ("clientId", "phone") DO NOTHING;

-- 4. Poblar Conversation desde mensajes sin clientId (números desconocidos)
INSERT INTO "Conversation" ("clientId", "phone", "lastMessageAt", "unreadCount", "createdAt")
SELECT
    NULL,
    m."phone",
    MAX(m."createdAt"),
    COALESCE(SUM(CASE WHEN m."direction" = 'inbound' AND m."status" = 'received' THEN 1 ELSE 0 END)::int, 0),
    MIN(m."createdAt")
FROM "Message" m
WHERE m."clientId" IS NULL
GROUP BY m."phone"
ON CONFLICT DO NOTHING;

-- 5. Poblar Conversation desde Notification (clientes que solo tienen notificaciones)
INSERT INTO "Conversation" ("clientId", "phone", "lastMessageAt", "unreadCount", "createdAt")
SELECT
    o."clientId",
    COALESCE(u."phone", n."recipient"),
    MAX(n."sentAt"),
    0,
    MIN(n."sentAt")
FROM "Notification" n
JOIN "Order" o ON o."id" = n."orderid"
LEFT JOIN "User" u ON u."id" = o."clientId"
WHERE o."clientId" IS NOT NULL AND n."sentAt" IS NOT NULL
GROUP BY o."clientId", COALESCE(u."phone", n."recipient")
ON CONFLICT ("clientId", "phone") DO UPDATE SET
    "lastMessageAt" = GREATEST("Conversation"."lastMessageAt", EXCLUDED."lastMessageAt");

-- 6. Vincular Message → Conversation (clientes conocidos)
UPDATE "Message" m SET "conversationId" = c."id"
FROM "Conversation" c
WHERE m."clientId" IS NOT NULL
  AND c."clientId" = m."clientId";

-- 7. Vincular Message → Conversation (números desconocidos)
UPDATE "Message" m SET "conversationId" = c."id"
FROM "Conversation" c
WHERE m."clientId" IS NULL
  AND c."clientId" IS NULL
  AND c."phone" = m."phone";

-- 8. Vincular Notification → Conversation
UPDATE "Notification" n SET "conversationId" = c."id"
FROM "Order" o, "Conversation" c
WHERE n."orderid" = o."id"
  AND o."clientId" IS NOT NULL
  AND c."clientId" = o."clientId";

-- 9. Añadir FK constraints
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id");

