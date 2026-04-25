import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export default fp(async function prismaPlugin(app: FastifyInstance) {
  const prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
  });

  // Kill any DB query that takes longer than 30s (prevents connection pool exhaustion).
  // The timer is always cleared — either by the query resolving or by the timeout
  // firing — so no dangling timers accumulate under load.
  prisma.$use(async (params, next) => {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`DB timeout: ${params.model}.${params.action} exceeded 30s`)),
        30_000,
      );
    });
    try {
      const result = await Promise.race([next(params), timeout]);
      clearTimeout(timer!);
      return result;
    } catch (err) {
      clearTimeout(timer!);
      throw err;
    }
  });

  await prisma.$connect();
  app.decorate('prisma', prisma);

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
});
