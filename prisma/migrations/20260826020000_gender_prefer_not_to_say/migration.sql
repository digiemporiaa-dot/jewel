-- "Prefer not to say" is an answer, not an absence.
--
-- Kept distinct from NULL on purpose. NULL means the question was never put —
-- every record created before the profile form existed — and that is the set the
-- admin's "Not recorded" filter exists to chase. This value means the customer
-- was asked and declined, and folding it into NULL would put them back on that
-- chase list for something they have already answered.
ALTER TYPE "Gender" ADD VALUE IF NOT EXISTS 'PREFER_NOT_TO_SAY';
