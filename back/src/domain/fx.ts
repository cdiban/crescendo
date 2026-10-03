import type { Currency } from './currency.ts';
import { Decimal } from './decimal.ts';
import { FxRateUnavailableError } from './errors.ts';

/** Monedas con tipo de cambio: las operables más CLF (Unidad de Fomento). */
export const FX_CURRENCIES = ['CLP', 'USD', 'EUR', 'CLF'] as const;
export type FxCurrency = (typeof FX_CURRENCIES)[number];

/** Un dato publicado: 1 `currency` = `rate` CLP el día `date`. Todo se guarda contra CLP. */
export type FxQuote = { currency: Exclude<FxCurrency, 'CLP'>; date: string; rate: Decimal };

/** Escala de los tipos de cambio derivados (NUMERIC(20,10)). */
export const FX_SCALE = 10;

/**
 * Tabla de tipos de cambio contra CLP con búsqueda "en o antes" (fines de semana y
 * feriados usan el último publicado). Los cruces se derivan: A/B = (A/CLP) / (B/CLP).
 */
export class FxTable {
  /** moneda → fechas ascendentes y sus valores. */
  readonly #series = new Map<string, { dates: string[]; rates: Decimal[] }>();

  constructor(quotes: Iterable<FxQuote>) {
    const grouped = new Map<string, FxQuote[]>();
    for (const quote of quotes) grouped.set(quote.currency, [...(grouped.get(quote.currency) ?? []), quote]);
    for (const [currency, list] of grouped) {
      list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      this.#series.set(currency, { dates: list.map((x) => x.date), rates: list.map((x) => x.rate) });
    }
  }

  /** Índice del último dato en o antes de `date`, o -1. */
  #index(currency: FxCurrency, date: string): number {
    const series = this.#series.get(currency);
    if (!series) return -1;
    let lo = 0;
    let hi = series.dates.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (series.dates[mid]! <= date) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }

  /** 1 `currency` = ? CLP en `date` (último publicado en o antes). */
  rateToClp(currency: FxCurrency, date: string): Decimal {
    if (currency === 'CLP') return Decimal.ONE;
    const i = this.#index(currency, date);
    if (i < 0) throw new FxRateUnavailableError(currency, date);
    return this.#series.get(currency)!.rates[i]!;
  }

  /** 1 `base` = ? `quote` en `date`. */
  rate(base: FxCurrency, quote: FxCurrency, date: string): Decimal {
    if (base === quote) return Decimal.ONE;
    const toClp = this.rateToClp(base, date);
    return quote === 'CLP' ? toClp : toClp.div(this.rateToClp(quote, date), FX_SCALE);
  }

  /** Convierte multiplicando primero y dividiendo una sola vez, para no acumular redondeo. */
  convert(amount: Decimal, from: Currency | FxCurrency, to: Currency | FxCurrency, date: string): Decimal {
    if (from === to) return amount;
    const clp = amount.mul(this.rateToClp(from, date));
    return to === 'CLP' ? clp : clp.div(this.rateToClp(to, date), FX_SCALE);
  }

  /** Fecha del último dato de `currency` en o antes de `date` (null si no hay o es CLP). */
  latestDate(currency: FxCurrency, date: string): string | null {
    if (currency === 'CLP') return null;
    const i = this.#index(currency, date);
    return i < 0 ? null : this.#series.get(currency)!.dates[i]!;
  }

  /** Datos publicados de `currency` en [from, to]. */
  quotes(currency: Exclude<FxCurrency, 'CLP'>, from: string, to: string): FxQuote[] {
    const series = this.#series.get(currency);
    if (!series) return [];
    return series.dates
      .map((date, i) => ({ currency, date, rate: series.rates[i]! }))
      .filter((x) => x.date >= from && x.date <= to);
  }
}
