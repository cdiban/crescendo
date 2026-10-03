import { roundAmount } from './amounts.ts';
import type { Currency } from './currency.ts';
import { Decimal } from './decimal.ts';

/** Escala de los pesos de exposición (fracción 0–1). */
export const WEIGHT_SCALE = 6;

type Converter = {
  /** Monto en `currency` → moneda de reporte al TC de `date`. */
  atDate: (amount: Decimal, currency: Currency, date: string) => Decimal;
  /** Monto en `currency` → moneda de reporte al TC actual. */
  atCurrent: (amount: Decimal, currency: Currency) => Decimal;
};

export type CashFxEffect = { currency: Currency; balance: Decimal; balanceAtCurrentRate: Decimal; fxEffect: Decimal };

/**
 * Efecto cambiario de la caja, por moneda: saldo a TC actual − Σ movimientos a TC de su fecha.
 * En la moneda de reporte es 0 por construcción.
 */
export function cashFxEffect(movements: ReadonlyArray<{ amount: Decimal; currency: Currency; date: string }>, fx: Converter): CashFxEffect[] {
  const byCurrency = new Map<Currency, { balance: Decimal; historical: Decimal }>();
  for (const m of movements) {
    const acc = byCurrency.get(m.currency) ?? { balance: Decimal.ZERO, historical: Decimal.ZERO };
    byCurrency.set(m.currency, { balance: acc.balance.add(m.amount), historical: acc.historical.add(fx.atDate(m.amount, m.currency, m.date)) });
  }
  return [...byCurrency.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([currency, { balance, historical }]) => {
      const current = roundAmount(fx.atCurrent(balance, currency));
      return { currency, balance, balanceAtCurrentRate: current, fxEffect: current.sub(roundAmount(historical)) };
    });
}

export type Exposure = { currency: Currency; amount: Decimal; weight: Decimal };

/** Distribución por moneda; los pesos suman exactamente 1 (el residuo de redondeo va a la mayor). */
export function exposureWeights(parts: ReadonlyArray<{ currency: Currency; amount: Decimal }>): Exposure[] {
  const byCurrency = new Map<Currency, Decimal>();
  for (const p of parts) byCurrency.set(p.currency, (byCurrency.get(p.currency) ?? Decimal.ZERO).add(p.amount));
  const items = [...byCurrency.entries()]
    .filter(([, amount]) => !amount.isZero())
    .map(([currency, amount]) => ({ currency, amount: roundAmount(amount) }))
    .sort((a, b) => b.amount.cmp(a.amount) || (a.currency < b.currency ? -1 : 1));
  const total = Decimal.sum(items.map((i) => i.amount));
  if (items.length === 0 || total.isZero()) return [];
  const weights = items.map((i) => ({ ...i, weight: i.amount.div(total, WEIGHT_SCALE) }));
  const residual = Decimal.ONE.sub(Decimal.sum(weights.map((w) => w.weight)));
  weights[0] = { ...weights[0]!, weight: weights[0]!.weight.add(residual) };
  return weights;
}
