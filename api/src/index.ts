import { buildApp } from './app.js';

const PORT = Number(process.env.PORT) || 3000;

const app = await buildApp();

// Graceful shutdown — allows in-flight requests to complete before exit
const shutdown = async (signal: string) => {
  app.log.info(`[api] ${signal} received — shutting down gracefully`);
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[api] listening on :${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
