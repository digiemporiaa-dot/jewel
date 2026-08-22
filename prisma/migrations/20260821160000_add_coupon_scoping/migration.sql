-- Jewellery-aware coupon scoping.
--
-- Additive and safe on live data. Existing coupons default to MAKING_CHARGES,
-- which is the conservative direction: a coupon that previously behaved as an
-- order-total discount now discounts only the margin-bearing component, so a
-- redeployed code cannot suddenly give away more than it used to.

-- CreateEnum
CREATE TYPE "CouponScope" AS ENUM ('MAKING_CHARGES', 'METAL_VALUE', 'STONE_VALUE', 'ORDER_TOTAL');

-- AlterTable
ALTER TABLE "Coupon"
  ADD COLUMN "appliesTo" "CouponScope" NOT NULL DEFAULT 'MAKING_CHARGES',
  ADD COLUMN "categoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "collectionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "metalTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "purities" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "minWeightGrams" DECIMAL(10,3),
  ADD COLUMN "maxWeightGrams" DECIMAL(10,3),
  ADD COLUMN "excludeDiscounted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "stackable" BOOLEAN NOT NULL DEFAULT false;
