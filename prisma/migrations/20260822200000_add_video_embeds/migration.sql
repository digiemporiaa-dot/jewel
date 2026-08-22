-- Video embeds.
--
-- Stored as `provider:id` (e.g. `youtube:dQw4w9WgXcQ`), never as markup and
-- never as a full URL. The address an operator types is validated on save and
-- the iframe is constructed in code from a fixed template, so this column can
-- never carry HTML onto a customer-facing page.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "videoUrl" TEXT;

-- A CMS block that shows one video.
ALTER TYPE "CmsBlockType" ADD VALUE IF NOT EXISTS 'VIDEO';
