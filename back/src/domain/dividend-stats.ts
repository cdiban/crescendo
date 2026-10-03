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

export type YoyMonth = { month: number; paidNet: Decimal; announcedNet: Decimal; ytdPaidNet: Decimal | null; growthVsPreviousYear: Decimal | null };
export type YoyYear = { year: number; totalPaidNet: Decimal; totalAnnouncedNet: Decimal; growth: Decimal | null; months: YoyMonth[] };

/**
 * Dividendos netos por mes calendario, un bloque por año pedido (ascendente), para comparar año
 * contra año. Los acumulados y variaciones usan los montos mensuales ya redondeados, así lo que se
 * muestra cuadra. Ver reglas de nulls en el contrato (/dividends/year-over-year).
 */
export function dividendsYearOverYear(input: { dividends: readonly ReportedDividend[]; years: readonly number[]; today: string }): {
  availableYears: number[];
  years: YoyYear[];
} {
  const availableYears = [...new Set(input.dividends.map((d) => Number(d.paymentDate.slice(0, 4))))].sort((a, b) => a - b);
  const firstDataYear = availableYears[0] ?? Number.POSITIVE_INFINITY;
  const currentYear = Number(input.today.slice(0, 4));
  const currentMonth = Number(input.today.slice(5, 7));
  const totals = dividendsByMonth({ dividends: input.dividends, from: `${input.today.slice(0, 4)}-01`, to: `${input.today.slice(0, 4)}-01`, today: input.today }).years;

  const monthly = (year: number, status: 'PAID' | 'ANNOUNCED') =>
    Array.from({ length: 12 }, (_, i) => {
      const prefix = `${year}-${String(i + 1).padStart(2, '0')}`;
      return roundAmount(Decimal.sum(input.dividends.filter((d) => d.status === status && d.paymentDate.startsWith(prefix)).map((d) => d.net)));
    });
  const isFuture = (year: number, month: number) => year > currentYear || (year === currentYear && month > currentMonth);

  const years = [...new Set(input.years)].sort((a, b) => a - b).map((year) => {
    const paid = monthly(year, 'PAID');
    const announced = monthly(year, 'ANNOUNCED');
    const previousPaid = year - 1 >= firstDataYear ? monthly(year - 1, 'PAID') : null;
    let ytd = Decimal.ZERO;
    const months = paid.map((paidNet, i) => {
      const month = i + 1;
      ytd = ytd.add(paidNet);
      const previous = previousPaid?.[i];
      return {
        month,
        paidNet,
        announcedNet: announced[i]!,
        ytdPaidNet: isFuture(year, month) ? null : ytd,
        growthVsPreviousYear:
          isFuture(year, month) || !previous || previous.isZero() ? null : paidNet.div(previous, RATE_SCALE).sub(Decimal.ONE),
      };
    });
    const total = totals.find((t) => t.year === year);
    return {
      year,
      totalPaidNet: Decimal.sum(paid),
      totalAnnouncedNet: Decimal.sum(announced),
      // Mismo crecimiento anual que /dividends/monthly (el año en curso contra el mismo período del anterior).
      growth: year - 1 >= firstDataYear && year <= currentYear ? (total?.growth ?? null) : null,
      months,
    };
  });
  return { availableYears, years };
}
