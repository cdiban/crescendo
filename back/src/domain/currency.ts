import type { Decimal } from './decimal.ts';

export const CURRENCIES = ['CLP', 'USD', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];

const SCALE: Record<Currency, number> = { CLP: 0, USD: 2, EUR: 2 };

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);
}

/** Redondeo half-up a la unidad mínima de la moneda (CLP 0 decimales, USD/EUR 2). */
export function roundToCurrency(amount: Decimal, currency: Currency): Decimal {
  return amount.round(SCALE[currency]);
}
