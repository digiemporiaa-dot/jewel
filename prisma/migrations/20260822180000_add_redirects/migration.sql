-- URL redirects.
--
-- Renaming a product silently breaks every link to it that already exists: in
-- Google's index, in a customer's WhatsApp history, and in whatever the shop
-- paid to advertise. A redirect table is what makes a rename safe.
--
-- fromPath is unique and stored normalised (leading slash, no trailing slash,
-- no query, lower-cased) so resolving one is a single index hit. That matters
-- more than usual here: the lookup runs for requests that would otherwise be
-- 404s, which includes every bot probing for /wp-admin.
CREATE TABLE IF NOT EXISTS "Redirect" (
    "id"          TEXT NOT NULL,
    "fromPath"    TEXT NOT NULL,
    "toPath"      TEXT NOT NULL,
    "statusCode"  INTEGER NOT NULL DEFAULT 301,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "note"        TEXT,
    "isAutomatic" BOOLEAN NOT NULL DEFAULT false,
    "createdBy"   TEXT,
    "hitCount"    INTEGER NOT NULL DEFAULT 0,
    "lastHitAt"   TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Redirect_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Redirect_fromPath_key" ON "Redirect"("fromPath");
CREATE INDEX IF NOT EXISTS "Redirect_isActive_idx" ON "Redirect"("isActive");
