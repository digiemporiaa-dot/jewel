-- EMI messaging settings. Additive and safe on live data; EMI is off until the
-- operator turns it on and supplies a tenure table.
ALTER TABLE "StoreSetting"
  ADD COLUMN "emiEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emiMinAmount" DECIMAL(12,2),
  ADD COLUMN "emiTenures" JSONB;
