-- GST-correct invoicing: HSN, place of supply, frozen tax breakup, and a
-- gap-free invoice series.
--
-- Every statement is additive and safe against live data. `prisma migrate
-- deploy` runs this at container start.
--
-- Note on Product.hsnCode: Postgres backfills existing rows with the DEFAULT,
-- so products already in the catalogue get 7113 ("articles of jewellery")
-- without a separate UPDATE. That is the intended outcome — a jeweller's
-- catalogue is 7113 unless someone says otherwise.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "invoiceNumber" TEXT,
ADD COLUMN     "placeOfSupply" TEXT,
ADD COLUMN     "taxBreakup" JSONB;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "hsnCode" TEXT DEFAULT '7113';

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "sellerStateCode" TEXT;

-- CreateTable
CREATE TABLE "InvoiceCounter" (
    "id" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceCounter_financialYear_key" ON "InvoiceCounter"("financialYear");

-- The unique index is the last line of defence on invoice numbering: even if the
-- counter logic were ever bypassed, the database refuses a duplicate number.
-- CreateIndex
CREATE UNIQUE INDEX "Order_invoiceNumber_key" ON "Order"("invoiceNumber");
