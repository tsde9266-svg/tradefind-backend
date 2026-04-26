-- Approve all currently pending workers.
-- MVP strategy: default approved, admin blocks bad actors
-- (instead of default pending, admin approves — which requires admin UI)
UPDATE "WorkerProfile" SET "status" = 'approved' WHERE "status" = 'pending';
