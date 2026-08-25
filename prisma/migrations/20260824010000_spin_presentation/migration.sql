-- The wheel's copy, image and colours, so a shop can change what it says without
-- a deploy. Typed fields only — there is no HTML or CSS field here, for the same
-- reason the CMS blocks have none.
ALTER TABLE "SpinCampaign" ADD COLUMN IF NOT EXISTS "presentation" JSONB;
