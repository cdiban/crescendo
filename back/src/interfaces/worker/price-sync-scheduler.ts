import type { PriceSyncReport, SyncPrices } from '../../application/use-cases/sync-prices.ts';

type Timers = { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (handle: unknown) => void };

/**
 * Ciclo de precios cada `intervalMs`: historia pendiente, cotizaciones de mercados abiertos y
 * consolidación del cierre. Cada paso se aísla: si uno falla (fuente o BD caída) se registra y
 * los demás corren igual; el ciclo siguiente se programa siempre.
 */
export function startPriceSyncScheduler(options: {
  syncPrices: Pick<SyncPrices, 'backfill' | 'refreshQuotes' | 'consolidate'>;
  intervalMs: number;
  log: (message: string) => void;
  timers?: Timers;
}): { firstCycle: Promise<void>; stop(): void } {
  const timers = options.timers ?? { setTimeout, clearTimeout: (h: unknown) => clearTimeout(h as NodeJS.Timeout) };
  let handle: unknown;
  let stopped = false;

  const step = async (label: string, work: () => Promise<PriceSyncReport>) => {
    try {
      const r = await work();
      if (r.fetched > 0 || r.failures.length > 0) {
        options.log(`${label}: ${r.fetched} cierres leídos, ${r.closesChanged} cambiados, ${r.quotesSaved} cotizaciones, ${r.failures.length} errores`);
      }
    } catch (err) {
      options.log(`${label}: ERROR ${(err as Error).message ?? String(err)} (se reintenta en el próximo ciclo)`);
    }
  };

  const cycle = async () => {
    await step('precios: historia', () => options.syncPrices.backfill());
    await step('precios: cotizaciones', () => options.syncPrices.refreshQuotes());
    await step('precios: cierre del día', () => options.syncPrices.consolidate());
    if (!stopped) handle = timers.setTimeout(() => void cycle(), options.intervalMs);
  };

  return {
    firstCycle: cycle(),
    stop() {
      stopped = true;
      timers.clearTimeout(handle);
    },
  };
}
