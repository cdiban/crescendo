import type { Decimal } from './decimal.ts';

/** Escalas de las columnas NUMERIC de la BD. */
export const AMOUNT_SCALE = 4;
export const QUANTITY_SCALE = 10;
export const PRICE_SCALE = 10;
export const RATE_SCALE = 6;

export function roundAmount(value: Decimal): Decimal {
  return value.round(AMOUNT_SCALE);
}
