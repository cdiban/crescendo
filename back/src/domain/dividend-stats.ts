import { roundAmount, RATE_SCALE } from './amounts.ts';
import { Decimal } from './decimal.ts';
import type { DividendStatus } from './dividend.ts';

/** Dividendo ya convertido a la moneda de reporte (sin redondear). */
export type ReportedDividend = { paymentDate: string; status: DividendStatus; net: Decimal; gross: Decimal; withholding: Decimal };

export type MonthPoint = { month: string; paidNet: Decimal; paidGross: Decimal; announcedNet: Decimal; cumulativePaidNet: Decimal };
export type YearTotal = { year: number; paidNet: Decimal; paidGross: Decimal; withholding: Decimal; growth: Decimal | null };

/** Meses calendario YYYY-MM entre from y to, inclusivos. */
export function monthRange(from: string, to: string): string[] {
  const months: string[] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

const sum = (list: ReportedDividend[], pick: (d: ReportedDividend) => Decimal) => roundAmount(Decimal.sum(list.map(pick)));

/**
 * Dividendos por mes (PAID y ANNOUNCED aparte, acumulado sólo PAID desde el primer dividendo) y por año
 * con crecimiento. El año en curso se compara contra el mismo período (hasta el mismo día) del anterior.
 */
export function dividendsByMonth(input: { dividends: readonly ReportedDividend[]; from: string; to: string; today: string }): {
  months: MonthPoint[];
  years: YearTotal[];
} {
  const paid = input.dividends.filter((d) => d.status === 'PAID');
  const announced = input.dividends.filter((d) => d.status === 'ANNOUNCED');

  let cumulative = Decimal.ZERO;
  for (const d of paid) if (d.paymentDate.slice(0, 7) < input.from) cumulative = cumulative.add(d.net);
  const months = monthRange(input.from, input.to).map((month) => {
    const inMonth = paid.filter((d) => d.paymentDate.startsWith(month));
    const net = Decimal.sum(inMonth.map((d) => d.net));
    cumulative = cumulative.add(net);
    return {
      month,
      paidNet: roundAmount(net),
      paidGross: sum(inMonth, (d) => d.gross),
      announcedNet: sum(announced.filter((d) => d.paymentDate.startsWith(month)), (d) => d.net),
      cumulativePaidNet: roundAmount(cumulative),
    };
  });

  const currentYear = Number(input.today.slice(0, 4));
  const monthDay = input.today.slice(5);
  const firstYear = paid.length === 0 ? currentYear : Math.min(...paid.map((d) => Number(d.paymentDate.slice(0, 4))));
  const years: YearTotal[] = [];
  for (let year = firstYear; year <= currentYear; year++) {
    const own = paid.filter((d) => d.paymentDate.startsWith(`${year}-`));
    // El año en curso contra el mismo período del anterior; los años cerrados, contra el año completo.
    const previous = paid.filter(
      (d) => d.paymentDate.startsWith(`${year - 1}-`) && (year < currentYear || d.paymentDate.slice(5) <= monthDay),
    );
    const net = sum(own, (d) => d.net);
    const prevNet = sum(previous, (d) => d.net);
    years.push({
      year,
      paidNet: net,
      paidGross: sum(own, (d) => d.gross),
      withholding: sum(own, (d) => d.withholding),
      growth: year === firstYear || prevNet.isZero() ? null : net.div(prevNet, RATE_SCALE).sub(Decimal.ONE),
    });
  }
  return { months, years };
}
