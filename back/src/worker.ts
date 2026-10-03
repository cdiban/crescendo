// Proceso de tareas programadas (servicio `worker` en Compose: misma imagen que la API).
// Hoy: tipos de cambio (backfill al iniciar + refresco periódico). En F3 se suman los precios.
import { buildContainer } from './composition.ts';
import { loadWorkerConfig } from './infrastructure/config.ts';
import { startFxSyncScheduler } from './interfaces/worker/fx-sync-scheduler.ts';

const log = (message: string) => console.log(`[worker] ${new Date().toISOString()} ${message}`);
const config = loadWorkerConfig(process.env);
const container = buildContainer(config, { log });
await container.start({ migrate: false });

const scheduler = startFxSyncScheduler({
  syncFx: container.useCases.syncFx,
  backfillFrom: config.fxBackfillFrom,
  intervalMs: config.fxSyncIntervalMinutes * 60_000,
  log,
});
log(`iniciado: backfill desde ${config.fxBackfillFrom}, refresco cada ${config.fxSyncIntervalMinutes} min`);

function shutdown(signal: string): void {
  log(`${signal} recibido, cerrando…`);
  scheduler.stop();
  void container.stop().finally(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
