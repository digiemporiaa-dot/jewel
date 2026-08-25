-- Spin-to-win.
--
-- Prizes are issued as real Coupon rows through the existing coupon path, so
-- there is exactly one discount engine. What is new here is the campaign that
-- defines the odds, the record of every spin, and a way to lock a won code to
-- the number that won it.

-- A won code is given to a phone number that has not been verified yet. The
-- check happens at checkout, where it has. `perUserLimit` cannot do this job:
-- it keys off customerId, and a guest checkout has none.
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "boundPhone" TEXT;
CREATE INDEX IF NOT EXISTS "Coupon_boundPhone_idx" ON "Coupon"("boundPhone");

CREATE TABLE IF NOT EXISTS "SpinCampaign" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "segments" JSONB NOT NULL,
  "perPhoneLimit" INTEGER NOT NULL DEFAULT 1,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "couponValidityDays" INTEGER NOT NULL DEFAULT 30,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SpinCampaign_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SpinCampaign_isActive_idx" ON "SpinCampaign"("isActive");

CREATE TABLE IF NOT EXISTS "SpinResult" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "segmentLabel" TEXT NOT NULL,
  "couponId" TEXT,
  -- Salted hash only. An IP is personal data and nothing here needs the address
  -- itself, only whether the same source has spun too often.
  "ipHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpinResult_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SpinResult_campaignId_createdAt_idx" ON "SpinResult"("campaignId", "createdAt");
CREATE INDEX IF NOT EXISTS "SpinResult_customerId_idx" ON "SpinResult"("customerId");
CREATE INDEX IF NOT EXISTS "SpinResult_ipHash_createdAt_idx" ON "SpinResult"("ipHash", "createdAt");

ALTER TABLE "SpinResult" ADD CONSTRAINT "SpinResult_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "SpinCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SpinResult" ADD CONSTRAINT "SpinResult_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SpinResult" ADD CONSTRAINT "SpinResult_couponId_fkey"
  FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;
