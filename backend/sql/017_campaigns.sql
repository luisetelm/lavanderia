-- 017_campaigns.sql
-- Tablas para campañas de marketing por WhatsApp.

CREATE TABLE IF NOT EXISTS campaign (
    id                SERIAL PRIMARY KEY,
    name              VARCHAR(120)  NOT NULL,
    "templateName"    VARCHAR(120)  NOT NULL,
    language          VARCHAR(10)   NOT NULL DEFAULT 'es',
    status            VARCHAR(20)   NOT NULL DEFAULT 'draft', -- draft, sending, completed, canceled
    filters           JSONB         NULL,
    "totalRecipients" INT           NOT NULL DEFAULT 0,
    "sentCount"       INT           NOT NULL DEFAULT 0,
    "failedCount"     INT           NOT NULL DEFAULT 0,
    "createdBy"       INT           NULL,
    "createdAt"       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    "updatedAt"       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaign_recipient (
    id           SERIAL PRIMARY KEY,
    "campaignId" INT          NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
    "clientId"   INT          NULL,
    phone        VARCHAR(30)  NOT NULL,
    "firstName"  VARCHAR(120) NULL,
    status       VARCHAR(20)  NOT NULL DEFAULT 'pending', -- pending, sent, failed
    "externalId" VARCHAR(120) NULL,
    error        VARCHAR(255) NULL,
    "sentAt"     TIMESTAMPTZ  NULL
);

CREATE INDEX IF NOT EXISTS idx_campaign_recipient_campaign ON campaign_recipient("campaignId");

