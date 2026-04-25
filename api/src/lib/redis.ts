import Redis from 'ioredis';

const GEO_KEY = 'workers_available';

export async function geoAddWorker(redis: Redis, workerId: string, userId: string, lat: number, lng: number) {
  // Pipeline: 3 commands in one TCP round-trip instead of 3 sequential calls
  const pipe = redis.pipeline();
  pipe.geoadd(GEO_KEY, lng, lat, workerId);
  pipe.hset(`worker:session:${userId}`, { workerId, lastSeen: Date.now() });
  pipe.expire(`worker:session:${userId}`, 7200); // 2 hours TTL
  await pipe.exec();
}

export async function geoRemoveWorker(redis: Redis, workerId: string, userId: string) {
  // Pipeline: 2 commands in one TCP round-trip
  const pipe = redis.pipeline();
  pipe.zrem(GEO_KEY, workerId);
  pipe.del(`worker:session:${userId}`);
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
