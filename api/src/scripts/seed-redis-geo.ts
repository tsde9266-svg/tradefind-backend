/**
 * Populate Redis geo index from Postgres worker data.
 * Runs on every container start (idempotent — GEOADD/SET just refresh existing entries).
 * Seeds ALL approved workers with coordinates so GEOSEARCH returns results
 * without requiring workers to manually toggle availability.
 */
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const GEO_KEY = 'workers_available';
const SEED_TTL = 60 * 60 * 24 * 30; // 30 days

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

async function main() {
  const workers = await prisma.workerProfile.findMany({
    where: {
      status: 'approved',
      latitude: { not: null },
      longitude: { not: null },
    },
    select: { id: true, userId: true, latitude: true, longitude: true },
  });

  if (workers.length === 0) {
    console.log('[seed-geo] No approved workers with coordinates found');
    return;
  }

  const pipe = redis.pipeline();
  for (const w of workers) {
    pipe.geoadd(GEO_KEY, w.longitude as number, w.latitude as number, w.id);
    pipe.set(`worker:geo:${w.id}`, w.userId, 'EX', SEED_TTL);
  }
  await pipe.exec();

  // Mark all seeded workers as available in Postgres
  await prisma.workerProfile.updateMany({
    where: { id: { in: workers.map((w) => w.id) } },
    data: { isAvailable: true },
  });

  console.log(`[seed-geo] Seeded ${workers.length} workers into Redis "${GEO_KEY}"`);
}

main()
  .catch((e) => { console.error('[seed-geo] Error:', e); process.exit(1); })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
