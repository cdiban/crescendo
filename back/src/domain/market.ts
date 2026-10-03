import type { Currency } from './currency.ts';
import type { Decimal } from './decimal.ts';

export type Market = {
  /** MIC ISO 10383, salvo "US" que agrupa las bolsas de EE.UU. */
  readonly code: string;
  readonly name: string;
  readonly country: string;
  readonly currency: Currency;
  readonly timezone: string;
  readonly defaultWithholdingRate: Decimal;
};
