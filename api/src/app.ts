import Fastify from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import prismaPlugin from './plugins/prisma.js';
import redisPlugin from './plugins/redis.js';
import authenticatePlugin from './plugins/authenticate.js';

import authRoutes from './routes/auth.js';
import workerRoutes from './routes/workers.js';
import reviewRoutes from './routes/reviews.js';
import notificationRoutes from './routes/notifications.js';
import uploadRoutes from './routes/upload.js';
import adminRoutes from './routes/admin.js';
import jobRoutes from './routes/jobs.js';

export async function buildApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
    trustProxy: true,
    // Protect against oversized JSON bodies (100kb max)
    bodyLimit: 100 * 1024,
    // Drop requests that take more than 30s
    requestTimeout: 30_000,
  });

  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : true;
  await app.register(cors, { origin: allowedOrigins, credentials: true });

  // Only compress responses larger than 1kb — compression is CPU-expensive
  await app.register(compress, { global: true, threshold: 1024 });

  await app.register(jwt, {
    secret: process.env.JWT_SECRET!,
    sign: { expiresIn: '15m' },
  });

  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  await app.register(rateLimit, {
    max: 200,            // per IP, not global
    timeWindow: '1 minute',
    skipOnError: true,
    keyGenerator: (request) =>
      request.headers['x-forwarded-for']?.toString().split(',')[0].trim() ??
      request.ip ??
      'unknown',
    errorResponseBuilder: () => ({
      success: false,
      error: 'Too many requests',
      code: 'RATE_LIMITED',
    }),
  });

  await app.register(swagger, {
    openapi: {
      info: { title: 'TradeFind API', version: '1.0.0' },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });

  await app.register(swaggerUi, { routePrefix: '/docs' });

  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(authenticatePlugin);

  // Health check — verifies DB and Redis are reachable
  app.get('/health', async (_request, reply) => {
    try {
      await Promise.all([
        app.prisma.$queryRaw`SELECT 1`,
        app.redis.ping(),
      ]);
      return { status: 'ok', ts: Date.now() };
    } catch (err) {
      app.log.error(err, '[health] dependency check failed');
      return reply.status(503).send({ status: 'degraded', ts: Date.now() });
    }
  });

  // API routes
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(workerRoutes, { prefix: '/api/workers' });
  await app.register(reviewRoutes, { prefix: '/api/reviews' });
  await app.register(notificationRoutes, { prefix: '/api/notifications' });
  await app.register(uploadRoutes, { prefix: '/api/upload' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.register(jobRoutes, { prefix: '/api/jobs' });

  // Global error handler
  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    if (error.statusCode === 429) {
      return reply.status(429).send({ success: false, error: 'Too many requests', code: 'RATE_LIMITED' });
    }
    const status = error.statusCode ?? 500;
    const message = status >= 500 ? 'Internal server error' : error.message;
    reply.status(status).send({ success: false, error: message, code: error.code ?? 'SERVER_ERROR' });
  });

  return app;
}
