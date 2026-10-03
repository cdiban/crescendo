import { roundAmount } from './amounts.ts';
import { Decimal } from './decimal.ts';
import { WEIGHT_SCALE } from './reporting.ts';

export type AllocationRow = { key: string; label: string; value: Decimal; valuedAtCost: Decimal; income: Decimal };
export type AllocationItem = {
  key: string;
  label: string;
  value: Decimal;
  weight: Decimal;
  expectedAnnualIncomeGross: Decimal;
  incomeWeight: Decimal;
  valuedAtCost: Decimal;
};

export const OTHERS_KEY = '__others';

/** Fracciones que suman exactamente 1: el residuo de redondeo va al primero (el mayor). */
function weights(values: Decimal[]): Decimal[] {
  const total = Decimal.sum(values);
  if (total.isZero()) return values.map(() => Decimal.ZERO);
  const w = values.map((v) => v.div(total, WEIGHT_SCALE));
  const residual = Decimal.ONE.sub(Decimal.sum(w));
  const largest = values.reduce((best, v, i) => (v.gt(values[best]!) ? i : best), 0);
  w[largest] = w[largest]!.add(residual);
  return w;
}

/**
 * Distribución por grupo: valor y peso, ingreso esperado y su peso (concentración de la renta).
 * Con `limit`, los primeros grupos por valor y un "Otros (N)" que agrega el resto (sus pesos se suman,
 * así el total sigue siendo 1).
 */
export function allocate(rows: readonly AllocationRow[], limit?: number): { total: Decimal; items: AllocationItem[] } {
  const groups = new Map<string, { label: string; value: Decimal; valuedAtCost: Decimal; income: Decimal }>();
  for (const r of rows) {
    const g = groups.get(r.key) ?? { label: r.label, value: Decimal.ZERO, valuedAtCost: Decimal.ZERO, income: Decimal.ZERO };
    groups.set(r.key, { label: g.label, value: g.value.add(r.value), valuedAtCost: g.valuedAtCost.add(r.valuedAtCost), income: g.income.add(r.income) });
  }
  const list = [...groups.entries()]
    .filter(([, g]) => !g.value.isZero() || !g.income.isZero())
    .map(([key, g]) => ({ key, label: g.label, value: roundAmount(g.value), valuedAtCost: roundAmount(g.valuedAtCost), income: roundAmount(g.income) }))
    .sort((a, b) => b.value.cmp(a.value) || (a.label < b.label ? -1 : 1));
  if (list.length === 0) return { total: Decimal.ZERO, items: [] };

  const valueWeights = weights(list.map((g) => g.value));
  const incomeWeights = weights(list.map((g) => g.income));
  const items: AllocationItem[] = list.map((g, i) => ({
    key: g.key,
    label: g.label,
    value: g.value,
    weight: valueWeights[i]!,
    expectedAnnualIncomeGross: g.income,
    incomeWeight: incomeWeights[i]!,
    valuedAtCost: g.valuedAtCost,
  }));
  const total = Decimal.sum(items.map((i) => i.value));
  if (limit === undefined || items.length <= limit) return { total, items };

  const rest = items.slice(limit);
  const sum = (pick: (i: AllocationItem) => Decimal) => Decimal.sum(rest.map(pick));
  return {
    total,
    items: [
      ...items.slice(0, limit),
      {
        key: OTHERS_KEY,
        label: `Otros (${rest.length})`,
        value: sum((i) => i.value),
        weight: sum((i) => i.weight),
        expectedAnnualIncomeGross: sum((i) => i.expectedAnnualIncomeGross),
        incomeWeight: sum((i) => i.incomeWeight),
        valuedAtCost: sum((i) => i.valuedAtCost),
      },
    ],
  };
}
