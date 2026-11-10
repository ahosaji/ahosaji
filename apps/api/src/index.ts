import { buildApp } from './app.js';
import { env } from './env.js';
import { shutdownDb } from './db.js';

async function main(): Promise<void> {
  const app = await buildApp();
  try {
    await app.listen({ port: env.port, host: env.host });
    app.log.info(`Ahosaji API listening on http://${env.host}:${env.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const close = async (signal: string): Promise<void> => {
    app.log.info(`received ${signal}, shutting down`);
    await app.close();
    await shutdownDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void close('SIGINT'));
  process.on('SIGTERM', () => void close('SIGTERM'));
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
