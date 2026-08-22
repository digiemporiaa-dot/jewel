-- The shop's own social handle, for the `twitter:site` card attribution.
ALTER TABLE "SeoSettings" ADD COLUMN IF NOT EXISTS "twitterHandle" TEXT;
