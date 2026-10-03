import { FX_CURRENCIES, type FxQuote } from '../../domain/fx.ts';
import type { Clock } from '../ports/clock.ts';
import type { FxRateProvider } from '../ports/fx-rate-provider.ts';
import type { UnitOfWork } from '../ports/unit-of-work.ts';

const SYNCED = FX_CURRENCIES.filter((c): c is FxQuote['currency'] => c !== 'CLP');
/** Un año pasado se considera completo si tiene datos de su última semana. */
const YEAR_END = '12-24';

export type SyncFailure = { currency: FxQuote['currency']; year: number; error: string };
export type SyncReport = { fetched: number; changed: number; failures: SyncFailure[] };

/**
 * Carga de tipos de cambio desde la fuente externa. Upsert idempotente; un error de la
 * fuente se informa y no detiene el resto (lo reintenta el próximo ciclo).
 */
export class SyncFx {
  readonly #deps: { uow: UnitOfWork; provider: FxRateProvider; clock: Clock; log: (message: string) => void };

  constructor(deps: { uow: UnitOfWork; provider: FxRateProvider; clock: Clock; log: (message: string) => void }) {
    this.#deps = deps;
  }

  /** Años faltantes desde `from` hasta hoy; el año en curso siempre se refresca. */
  async backfill(from: string): Promise<SyncReport> {
    const current = Number(this.#deps.clock.today().slice(0, 4));
    const jobs: Array<[FxQuote['currency'], number]> = [];
    for (let year = Number(from.slice(0, 4)); year <= current; year++) {
      for (const currency of SYNCED) {
        if (year < current) {
          const last = await this.#deps.uow.read((r) => r.fxRates.lastDateInYear(currency, year));
          if (last !== null && last >= `${year}-${YEAR_END}`) continue;
        }
        jobs.push([currency, year]);
      }
    }
    return this.#run(jobs);
  }

  /** Refresca el año en curso. */
  refresh(): Promise<SyncReport> {
    const current = Number(this.#deps.clock.today().slice(0, 4));
    return this.#run(SYNCED.map((currency) => [currency, current]));
  }

  async #run(jobs: Array<[FxQuote['currency'], number]>): Promise<SyncReport> {
    const report: SyncReport = { fetched: 0, changed: 0, failures: [] };
    for (const [currency, year] of jobs) {
      try {
        const quotes = await this.#deps.provider.fetchYear(currency, year);
        const changed = await this.#deps.uow.transaction((r) => r.fxRates.upsert(quotes));
        report.fetched += quotes.length;
        report.changed += changed;
        this.#deps.log(`fx ${currency} ${year}: ${quotes.length} datos, ${changed} nuevos o cambiados`);
      } catch (err) {
        const error = (err as Error).message ?? String(err);
        report.failures.push({ currency, year, error });
        this.#deps.log(`fx ${currency} ${year}: ERROR ${error} (se reintenta en el próximo ciclo)`);
      }
    }
    return report;
  }
}
