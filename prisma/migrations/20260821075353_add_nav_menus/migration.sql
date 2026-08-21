-- Adds NavMenu and attaches every NavItem to one.
--
-- NavItem already holds rows on deployed installs (the header menu), so the
-- required `menuId` cannot simply be added NOT NULL. The column arrives
-- nullable, existing rows are adopted by a 'header' menu, and only then is the
-- constraint tightened. `prisma migrate deploy` runs this against live data at
-- container start, so it has to be safe on both an empty and a populated table.

-- CreateTable
CREATE TABLE "NavMenu" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NavMenu_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NavMenu_key_key" ON "NavMenu"("key");

-- Seed the menus the storefront layout looks up. Fixed ids keep this migration
-- deterministic and let the backfill below reference the header menu directly.
INSERT INTO "NavMenu" ("id", "key", "label", "updatedAt") VALUES
  ('navmenu_header',       'header',       'Header',            CURRENT_TIMESTAMP),
  ('navmenu_footer_shop',  'footer-shop',  'Footer — Shop',     CURRENT_TIMESTAMP),
  ('navmenu_footer_help',  'footer-help',  'Footer — Help',     CURRENT_TIMESTAMP),
  ('navmenu_footer_about', 'footer-about', 'Footer — About',    CURRENT_TIMESTAMP),
  ('navmenu_footer_legal', 'footer-legal', 'Footer — Legal',    CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- AlterTable: nullable first so existing rows survive.
ALTER TABLE "NavItem" ADD COLUMN "menuId" TEXT;

-- Backfill: everything that existed before menus was the header navigation.
UPDATE "NavItem" SET "menuId" = 'navmenu_header' WHERE "menuId" IS NULL;

-- Now the column can carry its constraint.
ALTER TABLE "NavItem" ALTER COLUMN "menuId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "NavItem_menuId_order_idx" ON "NavItem"("menuId", "order");

-- AddForeignKey
ALTER TABLE "NavItem" ADD CONSTRAINT "NavItem_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "NavMenu"("id") ON DELETE CASCADE ON UPDATE CASCADE;
