import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import Redis from 'ioredis';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

export default fp(async function redisPlugin(app: FastifyInstance) {
  const redis = new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  redis.on('error', (err) => app.log.error({ err }, '[redis] error'));

  await redis.ping();
  app.decorate('redis', redis);

  app.addHook('onClose', async () => {
    await redis.quit();
  });
});
