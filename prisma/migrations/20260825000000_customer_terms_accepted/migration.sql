-- Proof that a customer agreed to the terms, and when.
--
-- A timestamp rather than a boolean: the question that gets asked later is
-- which version of the terms somebody accepted, and a `true` cannot answer it.
-- Null for records created implicitly by an OTP at checkout — nobody showed
-- those customers any terms, and backfilling a consent they never gave would be
-- worse than leaving the gap visible.
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "termsAcceptedAt" TIMESTAMP(3);
