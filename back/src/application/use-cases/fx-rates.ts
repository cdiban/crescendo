import type { Decimal } from '../../domain/decimal.ts';
import { FxRateUnavailableError } from '../../domain/errors.ts';
import { FxTable, type FxCurrency, type FxQuote } from '../../domain/fx.ts';
import { ValidationError } from '../errors.ts';
import type { Clock } from '../ports/clock.ts';
import type { UnitOfWork } from '../ports/unit-of-work.ts';

export type FxPoint = { date: string; rate: Decimal };
export type FxRateView = { base: FxCurrency; quote: FxCurrency; date: string; rate: Decimal; source: string };

export const MAX_SERIES_POINTS = 4000;
const REFERENCE_PAIRS: Array<[FxCurrency, FxCurrency]> = [['USD', 'CLP'], ['EUR', 'CLP'], ['EUR', 'USD'], ['CLF', 'CLP']];
const NO_LIMIT = '9999-12-31';

export class FxRates {
  readonly #uow: UnitOfWork;
  readonly #clock: Clock;

  constructor(deps: { uow: UnitOfWork; clock: Clock }) {
    this.#uow = deps.uow;
    this.#clock = deps.clock;
  }

  /** Serie de un par; los cruces sólo en fechas con publicación de algún lado y dato de ambos. */
  series(base: FxCurrency, quote: FxCurrency, from = '0000-01-01', to = NO_LIMIT): Promise<FxPoint[]> {
    if (base === quote) throw new ValidationError([{ field: 'quote', message: 'Debe ser distinta de base' }]);
    return this.#uow.read(async (r) => {
      const table = new FxTable(await r.fxRates.listUpTo(to));
      const sides = [base, quote].filter((c): c is FxQuote['currency'] => c !== 'CLP');
      const dates = [...new Set(sides.flatMap((c) => table.quotes(c, from, to).map((q) => q.date)))].sort();
      const points: FxPoint[] = [];
      for (const date of dates) {
        try {
          points.push({ date, rate: table.rate(base, quote, date) });
        } catch (err) {
          if (!(err instanceof FxRateUnavailableError)) throw err;
        }
      }
      if (points.length > MAX_SERIES_POINTS) {
        throw new ValidationError([{ field: 'from', message: `La serie supera ${MAX_SERIES_POINTS} puntos: acota el rango` }]);
      }
      return points;
    });
  }

  /** Último dato (en o antes de hoy) de los pares de referencia; los que no tienen dato se omiten. */
  latest(): Promise<FxRateView[]> {
    const today = this.#clock.today();
    return this.#uow.read(async (r) => {
      const quotes = await r.fxRates.listUpTo(today);
      const table = new FxTable(quotes);
      const source = (currency: FxCurrency, date: string) => quotes.find((q) => q.currency === currency && q.date === date)!.source;
      const views: FxRateView[] = [];
      for (const [base, quote] of REFERENCE_PAIRS) {
        const dates = [base, quote].map((c) => table.latestDate(c, today)).filter((d): d is string => d !== null);
        const needed = [base, quote].filter((c) => c !== 'CLP').length;
        if (dates.length < needed) continue;
        const date = dates.sort().at(-1)!;
        const direct = quote === 'CLP';
        views.push({ base, quote, date, rate: table.rate(base, quote, date), source: direct ? source(base, date) : 'derived:CLP' });
      }
      return views;
    });
  }
}
