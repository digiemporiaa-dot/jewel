-- Soft delete and archiving.
--
-- Nothing here removes a row. Orders and customers carry financial history that
-- has to survive: GST invoices are retained for years, deleting a customer
-- breaks the foreign keys of every order they placed, and refund and chargeback
-- disputes surface months after the fact needing the original record.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "anonymisedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
