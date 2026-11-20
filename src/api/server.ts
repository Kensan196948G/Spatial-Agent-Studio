import { loadConfig } from './config';
import { buildApp } from './app';

const config = loadConfig();
const host = process.env.HOST ?? '127.0.0.1';
const app = await buildApp(config);

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await app.listen({ port: config.port, host });
  app.log.info(
    { port: config.port, host, nodeEnv: config.nodeEnv, aiMode: 'demo-deterministic' },
    'Spatial Agent Studio API started',
  );
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
