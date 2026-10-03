import { consolidationDue, derivePriceSymbol, isMarketOpen, marketLocalDate } from '../../domain/market-data.ts';
import type { Instrument } from '../../domain/instrument.ts';
import { UnknownPriceSymbolError, type MarketDataProvider } from '../ports/market-data-provider.ts';
import type { TradedInstrument } from '../ports/repositories.ts';
import type { UnitOfWork } from '../ports/unit-of-work.ts';

export type PriceSyncFailure = { instrumentId: string; priceSymbol: string; error: string };
export type PriceSyncReport = { fetched: number; closesChanged: number; quotesSaved: number; failures: PriceSyncFailure[] };

type Target = { instrument: Instrument; priceSymbol: string; traded: TradedInstrument | undefined };

/** Días hacia atrás antes de la primera operación (para tener precio desde el primer día). */
const HISTORY_LEAD_DAYS = 7;
/** Una posición abierta con historia más vieja que esto se rellena en el backfill. */
const STALE_DAYS = 5;
/** Ventana corta para cotización + cierres recientes. */
const RECENT_DAYS = 7;
/** Un instrumento recién creado recibe precio aunque aún no tenga operaciones. */
const NEW_INSTRUMENT_DAYS = 7;

const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Sincronización de precios con la fuente externa: llamadas secuenciales con pausa (cortesía con
 * la fuente); un error de un instrumento se informa y no detiene el ciclo.
 */
export class SyncPrices {
  readonly #deps: {
    uow: UnitOfWork;
    provider: MarketDataProvider;
    now: () => Date;
    log: (message: string) => void;
    pause: (ms: number) => Promise<void>;
    pauseMs?: number;
  };
  /** mercado → última fecha local consolidada (en memoria: tras reiniciar se vuelve a consolidar, es idempotente). */
  readonly #consolidated = new Map<string, string>();

  constructor(deps: { uow: UnitOfWork; provider: MarketDataProvider; now: () => Date; log: (message: string) => void; pause: (ms: number) => Promise<void>; pauseMs?: number }) {
    this.#deps = deps;
  }

  async #targets(): Promise<Target[]> {
    return this.#deps.uow.read(async (r) => {
      const traded = await r.trades.tradedInstruments();
      const recent = await r.instruments.createdSince(new Date(this.#deps.now().getTime() - NEW_INSTRUMENT_DAYS * 86_400_000));
      const byId = new Map(traded.map((t) => [t.instrumentId, t]));
      const instruments = new Map((await r.instruments.findByIds(traded.map((t) => t.instrumentId))).map((i) => [i.id, i]));
      for (const i of recent) instruments.set(i.id, i);
      return [...instruments.values()]
        .map((instrument) => ({ instrument, priceSymbol: derivePriceSymbol(instrument), traded: byId.get(instrument.id) }))
        .filter((t): t is Target => t.priceSymbol !== null)
        .sort((a, b) => (a.priceSymbol < b.priceSymbol ? -1 : 1));
    });
  }

  /** Historia pendiente: símbolo nuevo o cambiado (desde la primera operación − 7 días) u hoyo en una posición abierta. */
  async backfill(): Promise<PriceSyncReport> {
    const today = this.#deps.now().toISOString().slice(0, 10);
    const jobs: Array<Target & { from: string; markSynced: boolean }> = [];
    for (const t of await this.#targets()) {
      const start = shift(t.traded?.firstTradeDate ?? today, -HISTORY_LEAD_DAYS);
      if (t.instrument.priceSyncedSymbol !== t.priceSymbol) {
        jobs.push({ ...t, from: start, markSynced: true });
        continue;
      }
      if (!t.traded?.open) continue;
      const last = await this.#deps.uow.read((r) => r.prices.lastCloseDate(t.instrument.id));
      if (last === null || last < shift(today, -STALE_DAYS)) jobs.push({ ...t, from: last ?? start, markSynced: false });
    }
    return this.#run(jobs);
  }

  /** Cotización (y cierres recientes) de posiciones abiertas cuyo mercado está abierto ahora. */
  async refreshQuotes(): Promise<PriceSyncReport> {
    const now = this.#deps.now();
    const targets = (await this.#targets()).filter((t) => t.traded?.open && isMarketOpen(t.instrument.marketCode, now));
    return this.#run(targets.map((t) => ({ ...t, from: shift(now.toISOString().slice(0, 10), -RECENT_DAYS), markSynced: false })));
  }

  /** Tras el cierre (+30 min), una pasada por mercado y día que consolida el cierre en la historia. */
  async consolidate(): Promise<PriceSyncReport> {
    const now = this.#deps.now();
    const targets = (await this.#targets()).filter((t) => t.traded?.open);
    const markets = [...new Set(targets.map((t) => t.instrument.marketCode))].filter(
      (m) => consolidationDue(m, now) && this.#consolidated.get(m) !== marketLocalDate(m, now),
    );
    const due = targets.filter((t) => markets.includes(t.instrument.marketCode));
    const report = await this.#run(due.map((t) => ({ ...t, from: shift(now.toISOString().slice(0, 10), -RECENT_DAYS), markSynced: false })));
    for (const m of markets) this.#consolidated.set(m, marketLocalDate(m, now));
    return report;
  }

  /** Carga manual (CLI): todos los instrumentos con operaciones, o uno por símbolo. */
  async syncAll(options: { from?: string | undefined; symbol?: string | undefined }): Promise<PriceSyncReport> {
    const today = this.#deps.now().toISOString().slice(0, 10);
    const targets = (await this.#targets()).filter((t) => !options.symbol || t.instrument.symbol === options.symbol.toUpperCase() || t.priceSymbol === options.symbol);
    return this.#run(
      targets.map((t) => ({ ...t, from: options.from ?? shift(t.traded?.firstTradeDate ?? today, -HISTORY_LEAD_DAYS), markSynced: true })),
    );
  }

  async #run(jobs: Array<Target & { from: string; markSynced: boolean }>): Promise<PriceSyncReport> {
    const report: PriceSyncReport = { fetched: 0, closesChanged: 0, quotesSaved: 0, failures: [] };
    for (const [n, job] of jobs.entries()) {
      if (n > 0) await this.#deps.pause(this.#deps.pauseMs ?? 500);
      const { instrument, priceSymbol } = job;
      try {
        const chart = await this.#deps.provider.fetchChart(priceSymbol, job.from);
        if (chart.currency !== instrument.currency) {
          throw new Error(`moneda de la fuente ${chart.currency} ≠ moneda del instrumento ${instrument.currency}`);
        }
        await this.#deps.uow.transaction(async (r) => {
          report.closesChanged += await r.prices.saveProviderCloses(instrument.id, chart.closes);
          if (chart.quote && (await r.prices.saveProviderQuote(instrument.id, chart.quote))) report.quotesSaved += 1;
          if (job.markSynced) await r.instruments.update({ ...instrument, priceSyncedSymbol: priceSymbol });
        });
        report.fetched += chart.closes.length;
      } catch (err) {
        const error = (err as Error).message ?? String(err);
        report.failures.push({ instrumentId: instrument.id, priceSymbol, error });
        const kind = err instanceof UnknownPriceSymbolError ? 'símbolo desconocido en la fuente' : 'error';
        this.#deps.log(`precios ${instrument.symbol} (${priceSymbol}): ${kind}: ${error}`);
      }
    }
    return report;
  }
}
