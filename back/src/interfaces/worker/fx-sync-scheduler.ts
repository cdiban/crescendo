import type { SyncFx } from '../../application/use-cases/sync-fx.ts';

type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type FxSyncSchedulerOptions = {
  syncFx: Pick<SyncFx, 'backfill' | 'refresh'>;
  backfillFrom: string;
  intervalMs: number;
  log: (message: string) => void;
  timers?: Timers;
};

/**
 * Programa la sincronización de tipos de cambio: backfill al iniciar y refresco periódico.
 * Ningún error (fuente caída, BD caída) detiene el ciclo: se registra y se reintenta.
 */
export function startFxSyncScheduler(options: FxSyncSchedulerOptions): { firstCycle: Promise<void>; stop(): void } {
  const timers = options.timers ?? { setTimeout, clearTimeout: (h: unknown) => clearTimeout(h as NodeJS.Timeout) };
  let handle: unknown;
  let stopped = false;

  const cycle = async (work: () => Promise<{ fetched: number; changed: number; failures: unknown[] }>, label: string) => {
    try {
      const report = await work();
      options.log(`${label}: ${report.fetched} datos, ${report.changed} cambios, ${report.failures.length} errores`);
    } catch (err) {
      options.log(`${label}: ERROR ${(err as Error).message ?? String(err)} (se reintenta en el próximo ciclo)`);
    }
    if (!stopped) handle = timers.setTimeout(() => void cycle(() => options.syncFx.refresh(), 'refresh fx'), options.intervalMs);
  };

  return {
    firstCycle: cycle(() => options.syncFx.backfill(options.backfillFrom), `backfill fx desde ${options.backfillFrom}`),
    stop() {
      stopped = true;
      timers.clearTimeout(handle);
    },
  };
}
