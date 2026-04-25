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

  // Kill any DB query that takes longer than 30 seconds (prevents connection pool exhaustion)
  prisma.$use(async (params, next) => {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('DB query timeout after 30s')), 30_000),
    );
    return Promise.race([next(params), timeout]);
  });

  await prisma.$connect();
  app.decorate('prisma', prisma);

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
});
