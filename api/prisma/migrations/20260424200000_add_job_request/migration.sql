-- Add new NotificationType values
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'job_request';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'job_accepted';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'job_declined';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'job_started';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'job_completed';

-- Create JobType enum
DO $$ BEGIN
    CREATE TYPE "JobType" AS ENUM ('in_app', 'call');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Create JobStatus enum
DO $$ BEGIN
    CREATE TYPE "JobStatus" AS ENUM ('pending', 'call_pending', 'accepted', 'started', 'completed', 'declined', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Create JobRequest table
CREATE TABLE IF NOT EXISTS "JobRequest" (
    "id"          TEXT        NOT NULL,
    "customerId"  TEXT        NOT NULL,
    "workerId"    TEXT        NOT NULL,
    "type"        "JobType"   NOT NULL DEFAULT 'in_app',
    "description" TEXT,
    "status"      "JobStatus" NOT NULL DEFAULT 'pending',
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobRequest_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "JobRequest_customerId_status_idx" ON "JobRequest"("customerId", "status");
CREATE INDEX IF NOT EXISTS "JobRequest_workerId_status_idx"   ON "JobRequest"("workerId",   "status");

-- Foreign keys
DO $$ BEGIN
    ALTER TABLE "JobRequest"
        ADD CONSTRAINT "JobRequest_customerId_fkey"
        FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "JobRequest"
        ADD CONSTRAINT "JobRequest_workerId_fkey"
        FOREIGN KEY ("workerId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
