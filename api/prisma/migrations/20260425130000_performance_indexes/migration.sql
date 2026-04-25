-- GIN index on WorkerProfile.trades array
-- Enables O(log N) lookup for trades: { has: trade } instead of full table scan
CREATE INDEX IF NOT EXISTS "WorkerProfile_trades_gin"
  ON "WorkerProfile" USING GIN ("trades");

-- Composite index for review pagination by worker, sorted newest-first
CREATE INDEX IF NOT EXISTS "Review_toWorkerId_createdAt_idx"
  ON "Review"("toWorkerId", "createdAt" DESC)
  WHERE "removed" = false;

-- Composite (customerId, workerId) for job duplicate check fast path
CREATE INDEX IF NOT EXISTS "JobRequest_customerId_workerId_idx"
  ON "JobRequest"("customerId", "workerId")
  WHERE "status" IN ('pending', 'call_pending', 'accepted', 'started');

-- Notification pagination by userId + createdAt (for cursor support)
CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx"
  ON "Notification"("userId", "createdAt" DESC);

-- WorkerProfile userId lookup (heavily used, only has @unique not an explicit index)
CREATE INDEX IF NOT EXISTS "WorkerProfile_userId_idx"
  ON "WorkerProfile"("userId");

-- JobRequest active jobs global view (for analytics / admin)
CREATE INDEX IF NOT EXISTS "JobRequest_status_createdAt_idx"
  ON "JobRequest"("status", "createdAt" DESC)
  WHERE "status" IN ('pending', 'call_pending', 'accepted', 'started');

-- User role index (admin queries filter by role)
CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User"("role");
