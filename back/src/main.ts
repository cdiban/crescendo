import { createServer } from 'node:http';
import { buildContainer } from './composition.ts';
import { loadConfig } from './infrastructure/config.ts';
import { createApp } from './interfaces/http/app.ts';

const config = loadConfig(process.env);
const container = buildContainer(config);
await container.start();

const server = createServer(createApp({ ...container.useCases, config }));
server.listen(config.port, () => console.log(`crescendo-api escuchando en :${config.port}`));

function shutdown(signal: string): void {
  console.log(`${signal} recibido, cerrando…`);
  server.close(() => {
    void container.stop().finally(() => process.exit(0));
  });
  server.closeIdleConnections();
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
