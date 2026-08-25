-- Gender becomes an enum.
--
-- The column stays NULLABLE. Customers created by the checkout OTP path before
-- the profile form existed have no gender, and a NOT NULL column would either
-- fail this migration outright or force a fabricated value onto real people's
-- records. The requirement is enforced in the form and the server action.
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- Existing free-text values move across where they map cleanly, and only where
-- they map cleanly. Anything ambiguous — "prefer not to say", a typo, a blank —
-- becomes NULL rather than being guessed into a bucket: a wrong value here is
-- worse than a missing one, because it looks like an answer the customer gave.
ALTER TABLE "Customer"
  ALTER COLUMN "gender" TYPE "Gender"
  USING (
    CASE lower(trim(both from coalesce("gender", '')))
      WHEN 'male'        THEN 'MALE'::"Gender"
      WHEN 'm'           THEN 'MALE'::"Gender"
      WHEN 'man'         THEN 'MALE'::"Gender"
      WHEN 'female'      THEN 'FEMALE'::"Gender"
      WHEN 'f'           THEN 'FEMALE'::"Gender"
      WHEN 'woman'       THEN 'FEMALE'::"Gender"
      WHEN 'other'       THEN 'OTHER'::"Gender"
      WHEN 'o'           THEN 'OTHER'::"Gender"
      WHEN 'non-binary'  THEN 'OTHER'::"Gender"
      WHEN 'nonbinary'   THEN 'OTHER'::"Gender"
      ELSE NULL
    END
  );

-- Segmentation reads this on the customer list, and a shop with a few thousand
-- customers filtering by gender should not table-scan for it.
CREATE INDEX IF NOT EXISTS "Customer_gender_idx" ON "Customer"("gender");
