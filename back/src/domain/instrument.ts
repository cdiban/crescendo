import type { Currency } from './currency.ts';
import type { Decimal } from './decimal.ts';
import type { Market } from './market.ts';

export const INSTRUMENT_TYPES = ['STOCK', 'ETF', 'FUND', 'REIT'] as const;
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

export const SYMBOL_PATTERN = /^[A-Z0-9.-]{1,20}$/;

export type Instrument = {
  readonly id: string;
  readonly symbol: string;
  readonly marketCode: string;
  readonly name: string;
  readonly type: InstrumentType;
  readonly currency: Currency;
  readonly sector: string | null;
  readonly industry: string | null;
  /** Override de la retención del mercado; null = usa la del mercado. */
  readonly withholdingRate: Decimal | null;
  readonly annualDividendPerShare: Decimal | null;
};

export type NewInstrument = Omit<Instrument, 'id'>;

export function effectiveWithholdingRate(instrument: Instrument, market: Market): Decimal {
  return instrument.withholdingRate ?? market.defaultWithholdingRate;
}
