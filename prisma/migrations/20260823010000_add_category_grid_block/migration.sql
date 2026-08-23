-- A CMS block that lists top-level categories.
--
-- The homepage is becoming a CMS page (reserved slug `home`) so a shop can edit
-- its own hero image and copy. "Shop by Category" was the one band on it that no
-- block type could express, and without it the CMS homepage would have been a
-- downgrade from the hardcoded one it replaces.
ALTER TYPE "CmsBlockType" ADD VALUE IF NOT EXISTS 'CATEGORY_GRID';
