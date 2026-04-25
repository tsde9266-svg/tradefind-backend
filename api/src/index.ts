import { buildApp } from './app.js';

const PORT = Number(process.env.PORT) || 3000;

const app = await buildApp();

// Graceful shutdown — closes server then exits.
// Force-exits after 8s so Docker's 10s SIGKILL window is respected
// (prevents in-flight 30s queries from blocking the shutdown indefinitely).
const shutdown = async (signal: string) => {
  app.log.info(`[api] ${signal} received — shutting down gracefully`);

  const forceExit = setTimeout(() => {
    app.log.warn('[api] shutdown timeout — forcing exit');
    process.exit(1);
  }, 8_000);
  forceExit.unref(); // don't let this timer keep the process alive

  try {
    await app.close();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    app.log.error(err, '[api] error during shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Catch any unhandled errors that bubble to process level
// (prevents silent crash without cleanup)
process.on('uncaughtException', (err) => {
  app.log.error(err, '[api] uncaughtException');
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  app.log.error({ reason }, '[api] unhandledRejection');
  shutdown('unhandledRejection');
});

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[api] listening on :${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
