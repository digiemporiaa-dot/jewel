-- Email becomes the verified identifier; the phone is collected but not proven.

-- A purpose for the codes that now actually establish identity.
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'EMAIL_VERIFY';

-- Phone stops being mandatory at the column.
--
-- The forms and server actions require it; the column records what is true.
-- Customers created by the old phone-only checkout have no email, and once
-- email is the identifier there will be records the other way round. Postgres
-- allows any number of NULLs under a unique index, so the existing
-- "Customer_phone_key" keeps doing its job for every row that has a number.
ALTER TABLE "Customer" ALTER COLUMN "phone" DROP NOT NULL;

-- Nobody's address has been proven yet, so the default is the truth for every
-- existing row. Backfilling it to true would invent a verification that never
-- happened, on exactly the field sign-in is about to depend on.
ALTER TABLE "Customer" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
