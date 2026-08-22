-- Storefront rate ticker configuration (singleton row, id = 'default').
-- Holds no rate of its own: the numbers come from the append-only MetalRate
-- rows the shop already prices from.
CREATE TABLE IF NOT EXISTS "RateTickerSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "purityIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "speedSeconds" INTEGER NOT NULL DEFAULT 40,
    "background" TEXT NOT NULL DEFAULT 'velvet',
    "showTimestamp" BOOLEAN NOT NULL DEFAULT true,
    "message" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateTickerSettings_pkey" PRIMARY KEY ("id")
);
