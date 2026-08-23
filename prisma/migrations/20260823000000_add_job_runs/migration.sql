-- One row per scheduled job, so the admin can tell the difference between
-- "nothing needed doing" and "nothing has ever called this endpoint".
CREATE TABLE IF NOT EXISTS "JobRun" (
    "name" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL,
    "lastStatus" TEXT NOT NULL,
    "lastMessage" TEXT,
    "lastDurationMs" INTEGER,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("name")
);
