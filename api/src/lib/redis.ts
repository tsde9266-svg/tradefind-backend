import Redis from 'ioredis';

const GEO_KEY = 'workers_available';

export async function geoAddWorker(redis: Redis, workerId: string, userId: string, lat: number, lng: number) {
  await redis.geoadd(GEO_KEY, lng, lat, workerId);
  // Store session keyed by userId so Go service can resolve workerId from JWT's userId claim
  await redis.hset(`worker:session:${userId}`, { workerId, lastSeen: Date.now() });
  await redis.expire(`worker:session:${userId}`, 7200); // 2 hours TTL
}

export async function geoRemoveWorker(redis: Redis, workerId: string, userId: string) {
  await redis.zrem(GEO_KEY, workerId);
  await redis.del(`worker:session:${userId}`);
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
  // GEOSEARCH key FROMLONLAT lng lat BYRADIUS r km ASC COUNT n WITHCOORD WITHDIST
  const raw = await redis.call(
    'GEOSEARCH',
    GEO_KEY,
    'FROMLONLAT', String(lng), String(lat),
    'BYRADIUS', String(radiusKm), 'km',
    'ASC',
    'COUNT', String(limit),
    'WITHCOORD',
    'WITHDIST',
  ) as Array<[string, string, [string, string]]>;

  return raw.map(([id, dist, [geoLng, geoLat]]) => ({
    id,
    distanceMetres: Math.round(parseFloat(dist) * 1000),
    lat: parseFloat(geoLat),
    lng: parseFloat(geoLng),
  }));
}
