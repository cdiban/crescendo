import type { Decimal } from '../../domain/decimal.ts';

export type MarketQuote = {
  price: Decimal;
  /** Momento de la cotización según la fuente. */
  asOf: Date;
  /** Fecha local (zona de la bolsa) de la cotización. */
  date: string;
  /** Último cierre anterior a `date` (para la variación del día). */
  previousClose: Decimal | null;
};

export type MarketChart = {
  priceSymbol: string;
  currency: string;
  /** Cierres diarios con dato (los días sin cierre se omiten, no se inventan). */
  closes: Array<{ date: string; close: Decimal }>;
  quote: MarketQuote | null;
};

/** El proveedor no conoce el símbolo: no se reintenta en cada ciclo como un error transitorio. */
export class UnknownPriceSymbolError extends Error {}

export interface MarketDataProvider {
  /** Cierres diarios desde `from` (YYYY-MM-DD) hasta hoy y la cotización actual. Lanza si la fuente falla. */
  fetchChart(priceSymbol: string, from: string): Promise<MarketChart>;
}
