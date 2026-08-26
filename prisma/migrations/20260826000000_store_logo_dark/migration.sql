-- A second logo for dark surfaces.
--
-- Nullable and unbackfilled on purpose: null means "no separate dark logo",
-- which is the correct starting state for every existing shop and is what the
-- footer falls back to `logoUrl` for. Copying `logoUrl` into it would be a lie
-- dressed as a default — it would claim the operator had checked the logo
-- against a dark background when nobody had.
ALTER TABLE "StoreSetting" ADD COLUMN "logoUrlDark" TEXT;
