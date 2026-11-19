import type { Decimal } from '../../domain/decimal.ts';
import type { PriceSource } from '../../domain/market-data.ts';
import { perShareAt, type SplitEvent } from '../../domain/split.ts';
import type { StoredClose, StoredQuote } from '../ports/repositories.ts';

export type CurrentPrice = { price: Decimal; previousClose: Decimal | null; asOf: Date; date: string; source: PriceSource; fromQuote: boolean };

/**
 * Precio vigente a una fecha: el más reciente entre la cotización (si su fecha ≤ la pedida) y el
 * último cierre en o antes; ante empate gana la cotización. Posiciones, resumen y serie histórica
 * usan esta misma regla, así el punto de hoy de la serie cuadra con el patrimonio del resumen.
 */
export function resolvePrice(quote: StoredQuote | undefined, close: StoredClose | undefined, date: string): CurrentPrice | null {
  const q = quote && quote.date <= date ? quote : undefined;
  if (q && (!close || q.date >= close.date)) return { price: q.price, previousClose: q.previousClose, asOf: q.asOf, date: q.date, source: q.source, fromQuote: true };
  if (close) return { price: close.close, previousClose: null, asOf: new Date(`${close.date}T00:00:00.000Z`), date: close.date, source: close.source, fromQuote: false };
  return null;
}

/** Búsqueda "en o antes" sobre cierres ascendentes. */
export function closeOnOrBefore(closes: readonly StoredClose[], date: string): StoredClose | undefined {
  let lo = 0;
  let hi = closes.length - 1;
  let found: StoredClose | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (closes[mid]!.date <= date) {
      found = closes[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * (v0.7) Precio guardado (real, en las acciones de su fecha) llevado a las acciones de `date`: ÷ el factor
 * de los splits en (fecha del precio, date]. El cierre anterior se lleva igual desde su propia fecha, así
 * un split no aparece como variación del día. Sin splits devuelve el mismo objeto.
 */
export function inSharesOf(price: CurrentPrice | null, date: string, splits: readonly SplitEvent[], previousCloseDate: string | null): CurrentPrice | null {
  if (!price || splits.length === 0) return price;
  return {
    ...price,
    price: perShareAt(price.price, splits, price.date, date),
    previousClose: price.previousClose && perShareAt(price.previousClose, splits, previousCloseDate ?? dayBefore(price.date), date),
  };
}
