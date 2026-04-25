-- Compound partial index on WorkerProfile (latitude, longitude)
-- Speeds up admin queries and any direct geo range queries.
-- Main geo search is done via Redis GEOSEARCH, but this helps
-- DB-level fallback queries and analytics.
CREATE INDEX IF NOT EXISTS "WorkerProfile_location_idx"
  ON "WorkerProfile"("latitude", "longitude")
  WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL;

-- Index for location history lookups (worker replay / analytics)
CREATE INDEX IF NOT EXISTS "LocationHistory_workerId_createdAt_idx"
  ON "LocationHistory"("workerId", "createdAt" DESC);

-- Notification type index for faster type-filtered queries
CREATE INDEX IF NOT EXISTS "Notification_type_idx" ON "Notification"("type");

-- RefreshToken expiry cleanup index
CREATE INDEX IF NOT EXISTS "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");
