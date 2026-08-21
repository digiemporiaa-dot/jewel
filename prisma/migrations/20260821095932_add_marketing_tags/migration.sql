-- Marketing & analytics tag configuration.
--
-- Both statements are safe against a populated database: the Order column is
-- nullable with no default, and MarketingTags is a new table. `prisma migrate
-- deploy` runs this at container start against live data.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "purchaseTrackedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MarketingTags" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "gtmId" TEXT,
    "ga4MeasurementId" TEXT,
    "googleAdsId" TEXT,
    "googleAdsLabel" TEXT,
    "googleSiteVerification" TEXT,
    "metaPixelId" TEXT,
    "metaCapiToken" TEXT,
    "metaCapiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "clarityProjectId" TEXT,
    "hotjarSiteId" TEXT,
    "pinterestTagId" TEXT,
    "tiktokPixelId" TEXT,
    "snapPixelId" TEXT,
    "consentMode" TEXT NOT NULL DEFAULT 'REQUIRED',
    "consentBannerText" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingTags_pkey" PRIMARY KEY ("id")
);

-- Create the singleton row so the admin screen and the storefront reader always
-- find a record. Every tag starts NULL, i.e. tracking off, and the consent mode
-- defaults to REQUIRED — the store opts in deliberately rather than by accident.
INSERT INTO "MarketingTags" ("id", "updatedAt") VALUES ('default', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
