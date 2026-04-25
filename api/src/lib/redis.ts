import Redis from 'ioredis';

const GEO_KEY   = 'workers_available';
const GEO_TTL   = 7200; // 2 hours — matches worker session TTL

export async function geoAddWorker(redis: Redis, workerId: string, userId: string, lat: number, lng: number) {
  const pipe = redis.pipeline();
  pipe.geoadd(GEO_KEY, lng, lat, workerId);
  pipe.hset(`worker:session:${userId}`, { workerId, lastSeen: Date.now() });
  pipe.expire(`worker:session:${userId}`, GEO_TTL);
  // Also tag the workerId→userId reverse lookup so GEOSEARCH results can be
  // cross-checked for freshness, and stale entries auto-expire via TTL
  pipe.set(`worker:geo:${workerId}`, userId, 'EX', GEO_TTL);
  await pipe.exec();
}

export async function geoRemoveWorker(redis: Redis, workerId: string, userId: string) {
  const pipe = redis.pipeline();
  pipe.zrem(GEO_KEY, workerId);
  pipe.del(`worker:session:${userId}`);
  pipe.del(`worker:geo:${workerId}`);
  await pipe.exec();
}

export interface GeoWorker {
  id: string;
  distanceMetres: number;
  lat: number;
  lng: number;
}

export async function geoSearchNearby(
  redis: Redis,
  lat: number,
  lng: number,
  radiusKm: number,
  limit = 50,
): Promise<GeoWorker[]> {
  let raw: unknown;
  try {
    raw = await redis.call(
      'GEOSEARCH',
      GEO_KEY,
      'FROMLONLAT', String(lng), String(lat),
      'BYRADIUS', String(radiusKm), 'km',
      'ASC',
      'COUNT', String(limit),
      'WITHCOORD',
      'WITHDIST',
    );
  } catch (err) {
    // Redis command error — return empty rather than crashing the request
    console.error('[redis] GEOSEARCH failed:', err);
    return [];
  }

  if (!Array.isArray(raw)) return [];

  // Validate each entry shape before casting — silent data corruption protection
  return (raw as unknown[]).flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length < 3) return [];
    const [id, dist, coord] = entry as [unknown, unknown, unknown];
    if (typeof id !== 'string' || typeof dist !== 'string') return [];
    if (!Array.isArray(coord) || coord.length < 2) return [];
    const [geoLng, geoLat] = coord as [unknown, unknown];
    if (typeof geoLng !== 'string' || typeof geoLat !== 'string') return [];
    return [{
      id,
      distanceMetres: Math.round(parseFloat(dist) * 1000),
      lat: parseFloat(geoLat),
      lng: parseFloat(geoLng),
    }];
  });
}
