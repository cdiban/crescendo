import type { SyncFx } from '../../application/use-cases/sync-fx.ts';

type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

/** Cada cuánto se revisa si toca cargar: un fallo se reintenta en el próximo tick. */
export const FX_TICK_MS = 15 * 60_000;

export type FxSyncSchedulerOptions = {
  syncFx: Pick<SyncFx, 'backfill' | 'refresh'>;
  backfillFrom: string;
  intervalMs: number;
  log: (message: string) => void;
  timers?: Timers;
  /** Hora real (ms). Se compara contra ella y no contra el timer, que no avanza mientras el equipo duerme. */
  now?: () => number;
};

/**
 * Programa la sincronización de tipos de cambio: backfill al iniciar y, cada `FX_TICK_MS`, un refresh
 * si el último intento falló (o tuvo errores) o si pasaron `intervalMs` de hora real desde la última
 * carga exitosa. Ningún error (fuente caída, BD caída) detiene el ciclo: se registra y se reintenta.
 */
export function startFxSyncScheduler(options: FxSyncSchedulerOptions): { firstCycle: Promise<void>; stop(): void } {
  const timers = options.timers ?? { setTimeout, clearTimeout: (h: unknown) => clearTimeout(h as NodeJS.Timeout) };
  const now = options.now ?? Date.now;
  let handle: unknown;
  let stopped = false;
  /** Hora real de la última carga sin errores; `undefined` si el último intento falló. */
  let lastSuccessAt: number | undefined;

  const run = async (work: () => Promise<{ fetched: number; changed: number; failures: unknown[] }>, label: string) => {
    try {
      const report = await work();
      options.log(`${label}: ${report.fetched} datos, ${report.changed} cambios, ${report.failures.length} errores`);
      lastSuccessAt = report.failures.length === 0 ? now() : undefined;
    } catch (err) {
      options.log(`${label}: ERROR ${(err as Error).message ?? String(err)} (se reintenta en el próximo ciclo)`);
      lastSuccessAt = undefined;
    }
  };

  const schedule = () => {
    if (!stopped) handle = timers.setTimeout(() => void tick(), FX_TICK_MS);
  };

  const tick = async () => {
    if (lastSuccessAt === undefined || now() - lastSuccessAt >= options.intervalMs) {
      await run(() => options.syncFx.refresh(), 'refresh fx');
    }
    schedule();
  };

  return {
    firstCycle: run(() => options.syncFx.backfill(options.backfillFrom), `backfill fx desde ${options.backfillFrom}`).then(schedule),
    stop() {
      stopped = true;
      timers.clearTimeout(handle);
    },
  };
}
