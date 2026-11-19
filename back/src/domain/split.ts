import { PRICE_SCALE, QUANTITY_SCALE } from './amounts.ts';
import { Decimal } from './decimal.ts';

// Fase 6 — Splits. Dato del catálogo global: operaciones y dividendos no se modifican. Desde
// `effectiveDate` (al inicio del día) cada `denominator` acciones pasan a ser `numerator`.

export const SPLIT_TERM_MAX = 1000;

export type Split = {
  readonly id: string;
  readonly instrumentId: string;
  /** YYYY-MM-DD */
  readonly effectiveDate: string;
  readonly numerator: number;
  readonly denominator: number;
  readonly createdAt: Date;
};

export type NewSplit = Pick<Split, 'instrumentId' | 'effectiveDate' | 'numerator' | 'denominator'>;
export type SplitEvent = NewSplit;

/** cantidad × numerator / denominator, a 10 decimales. */
export function splitQuantity(quantity: Decimal, s: Pick<SplitEvent, 'numerator' | 'denominator'>): Decimal {
  return quantity.mul(Decimal.fromInt(s.numerator)).div(Decimal.fromInt(s.denominator), QUANTITY_SCALE);
}

/** Producto de numeradores y denominadores de los splits con fecha en (from, to]; null si no hay ninguno. */
function ratio(splits: readonly SplitEvent[], from: string, to: string): [Decimal, Decimal] | null {
  let numerator = Decimal.ONE;
  let denominator = Decimal.ONE;
  let any = false;
  for (const s of splits) {
    if (s.effectiveDate <= from || s.effectiveDate > to) continue;
    numerator = numerator.mul(Decimal.fromInt(s.numerator));
    denominator = denominator.mul(Decimal.fromInt(s.denominator));
    any = true;
  }
  return any ? [numerator, denominator] : null;
}

/**
 * Monto por acción (precio, DPA) en las acciones de `from` llevado a las de `to`: ÷ el factor de cada
 * split en (from, to], a 10 decimales. Sin splits en el rango devuelve el mismo valor, sin redondear.
 * Los splits deben ser del mismo instrumento.
 */
export function perShareAt(value: Decimal, splits: readonly SplitEvent[], from: string, to: string): Decimal {
  const r = ratio(splits, from, to);
  return r ? value.mul(r[1]).div(r[0], PRICE_SCALE) : value;
}

/** Cantidad en las acciones de `from` llevada a las de `to`: × el factor de cada split en (from, to], a 10 decimales. */
export function sharesAt(quantity: Decimal, splits: readonly SplitEvent[], from: string, to: string): Decimal {
  const r = ratio(splits, from, to);
  return r ? quantity.mul(r[0]).div(r[1], QUANTITY_SCALE) : quantity;
}
