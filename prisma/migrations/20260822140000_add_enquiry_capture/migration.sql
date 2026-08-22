-- Automatic enquiry capture.
--
-- A WhatsApp click-to-chat link never tells the site who clicked it: the visitor
-- opens WhatsApp and the shop learns their number only when they actually send
-- the message. Capturing the click is still worth doing — it is the difference
-- between knowing which pieces drive enquiries and guessing — so Lead.name and
-- Lead.phone become nullable for leads the site raises on its own. Staff-entered
-- leads still require both; that is enforced in the form, not the column.
ALTER TABLE "Lead" ALTER COLUMN "name" DROP NOT NULL;
ALTER TABLE "Lead" ALTER COLUMN "phone" DROP NOT NULL;

-- Repeat clicks collapse into one lead instead of twenty, and the repeat count
-- is kept rather than discarded: four enquiries on one piece is a warmer lead
-- than one, and sales cannot see that if the extras are dropped.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "sessionToken" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "touchCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;

-- The de-duplication guarantee comes from Postgres, not from application logic:
-- a check-then-insert would let two simultaneous clicks both pass the check.
-- NULLs are exempt from a UNIQUE index, so hand-entered leads are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS "Lead_dedupeKey_key" ON "Lead"("dedupeKey");

-- Looking up an anonymous visitor's existing lead, and the source+date filters
-- the CRM list uses.
CREATE INDEX IF NOT EXISTS "Lead_sessionToken_idx" ON "Lead"("sessionToken");
CREATE INDEX IF NOT EXISTS "Lead_source_createdAt_idx" ON "Lead"("source", "createdAt");
