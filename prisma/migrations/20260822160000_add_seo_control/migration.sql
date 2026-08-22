-- Operator-controllable SEO.
--
-- The five content models already carried seoTitle and seoDescription. These
-- three columns are what was missing to make a page's search and social
-- appearance fully editable without a code change:
--
--   ogImageUrl   — social card image; a shared link with no card looks broken
--   canonicalUrl — override for the computed canonical, validated on save
--   noIndex      — keep a page out of search while leaving it reachable
--
-- noIndex defaults to false so nothing already published disappears from search
-- the moment this migration runs.

ALTER TABLE "Product"    ADD COLUMN IF NOT EXISTS "ogImageUrl" TEXT;
ALTER TABLE "Product"    ADD COLUMN IF NOT EXISTS "canonicalUrl" TEXT;
ALTER TABLE "Product"    ADD COLUMN IF NOT EXISTS "noIndex" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Category"   ADD COLUMN IF NOT EXISTS "ogImageUrl" TEXT;
ALTER TABLE "Category"   ADD COLUMN IF NOT EXISTS "canonicalUrl" TEXT;
ALTER TABLE "Category"   ADD COLUMN IF NOT EXISTS "noIndex" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Collection" ADD COLUMN IF NOT EXISTS "ogImageUrl" TEXT;
ALTER TABLE "Collection" ADD COLUMN IF NOT EXISTS "canonicalUrl" TEXT;
ALTER TABLE "Collection" ADD COLUMN IF NOT EXISTS "noIndex" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "CmsPage"    ADD COLUMN IF NOT EXISTS "ogImageUrl" TEXT;
ALTER TABLE "CmsPage"    ADD COLUMN IF NOT EXISTS "canonicalUrl" TEXT;
ALTER TABLE "CmsPage"    ADD COLUMN IF NOT EXISTS "noIndex" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "BlogPost"   ADD COLUMN IF NOT EXISTS "ogImageUrl" TEXT;
ALTER TABLE "BlogPost"   ADD COLUMN IF NOT EXISTS "canonicalUrl" TEXT;
ALTER TABLE "BlogPost"   ADD COLUMN IF NOT EXISTS "noIndex" BOOLEAN NOT NULL DEFAULT false;

-- Site-wide SEO configuration. Singleton, like StoreSetting and MarketingTags.
--
-- indexingEnabled defaults to true: a fresh deployment of an existing shop must
-- not silently drop out of search because a new row defaulted to "off".
CREATE TABLE IF NOT EXISTS "SeoSettings" (
    "id"                    TEXT NOT NULL DEFAULT 'default',
    "titleTemplate"         TEXT,
    "defaultTitle"          TEXT,
    "defaultDescription"    TEXT,
    "defaultOgImageUrl"     TEXT,
    "indexingEnabled"       BOOLEAN NOT NULL DEFAULT true,
    "robotsDisallow"        TEXT[] DEFAULT ARRAY[]::TEXT[],
    "localBusinessEnabled"  BOOLEAN NOT NULL DEFAULT false,
    "businessType"          TEXT DEFAULT 'JewelryStore',
    "priceRange"            TEXT,
    "latitude"              DECIMAL(10,7),
    "longitude"             DECIMAL(10,7),
    "openingHours"          JSONB,
    "bingVerification"      TEXT,
    "pinterestVerification" TEXT,
    "updatedAt"             TIMESTAMP(3) NOT NULL,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeoSettings_pkey" PRIMARY KEY ("id")
);
