import { roundAmount } from './amounts.ts';
import type { Currency } from './currency.ts';
import { Decimal } from './decimal.ts';
import { isBusinessDate } from './dates.ts';
import { monthRange } from './dividend-stats.ts';

export type CalendarItem = {
  instrumentId: string;
  symbol: string;
  status: 'ANNOUNCED' | 'ESTIMATED';
  date: string;
  currency: Currency;
  netAmount: Decimal;
  netAmountReporting: Decimal;
};

export type CalendarMonth = { month: string; totalNet: Decimal; announcedNet: Decimal; estimatedNet: Decimal; items: CalendarItem[] };

/** Mismo día del año siguiente (29-feb → 28-feb). */
function oneYearAfter(date: string): string {
  const year = Number(date.slice(0, 4)) + 1;
  const candidate = `${year}${date.slice(4)}`;
  return isBusinessDate(candidate) ? candidate : `${year}-02-28`;
}

/**
 * Estimado del próximo pago a partir de uno cobrado: mismo monto por acción (o bruto / cantidad de
 * entonces), cantidad actual y retención efectiva; fecha = mismo día del año siguiente.
 */
export function estimateNextDividend(
  paid: { paymentDate: string; perShare: Decimal | null; grossAmount: Decimal; quantityThen: Decimal | null },
  now: { quantityNow: Decimal; withholdingRate: Decimal },
): { date: string; netAmount: Decimal } | null {
  const perShare = paid.perShare ?? (paid.quantityThen?.isPositive() ? paid.grossAmount.div(paid.quantityThen, 10) : null);
  if (perShare === null || !now.quantityNow.isPositive()) return null;
  const gross = perShare.mul(now.quantityNow);
  return { date: oneYearAfter(paid.paymentDate), netAmount: roundAmount(gross.mul(Decimal.ONE.sub(now.withholdingRate))) };
}

/** Calendario de 12 meses desde el actual: anunciados + estimados, sin duplicar un estimado de un instrumento y mes ya anunciado. */
export function buildCalendar(input: { today: string; announced: readonly CalendarItem[]; estimated: readonly CalendarItem[] }): {
  months: CalendarMonth[];
  totalNet: Decimal;
} {
  const start = input.today.slice(0, 7);
  const [y, m] = start.split('-').map(Number) as [number, number];
  const end = new Date(Date.UTC(y, m - 1 + 11, 1)).toISOString().slice(0, 7);
  const months = monthRange(start, end);
  const inWindow = (i: CalendarItem) => i.date.slice(0, 7) >= start && i.date.slice(0, 7) <= end;
  const announced = input.announced.filter(inWindow);
  const taken = new Set(announced.map((i) => `${i.instrumentId}|${i.date.slice(0, 7)}`));
  const estimated = input.estimated.filter((i) => inWindow(i) && !taken.has(`${i.instrumentId}|${i.date.slice(0, 7)}`));

  const result = months.map((month) => {
    const items = [...announced, ...estimated]
      .filter((i) => i.date.startsWith(month))
      .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.symbol < b.symbol ? -1 : 1));
    const sum = (status: CalendarItem['status']) => Decimal.sum(items.filter((i) => i.status === status).map((i) => i.netAmountReporting));
    const announcedNet = sum('ANNOUNCED');
    const estimatedNet = sum('ESTIMATED');
    return { month, items, announcedNet, estimatedNet, totalNet: announcedNet.add(estimatedNet) };
  });
  return { months: result, totalNet: Decimal.sum(result.map((r) => r.totalNet)) };
}
