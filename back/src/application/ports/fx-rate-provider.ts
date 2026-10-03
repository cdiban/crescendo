import type { FxQuote } from '../../domain/fx.ts';

export type FetchedFxQuote = FxQuote & { source: string };

/** Fuente externa de tipos de cambio (contra CLP). */
export interface FxRateProvider {
  /** Todos los datos publicados de `currency` en el año. Lanza si la fuente falla. */
  fetchYear(currency: FxQuote['currency'], year: number): Promise<FetchedFxQuote[]>;
}
