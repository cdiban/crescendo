import { RATE_SCALE } from './amounts.ts';
import { oneYearBefore } from './dates.ts';
import { Decimal } from './decimal.ts';
import type { DividendKind } from './dividend.ts';

// P4 — Dividendo por acción (DPA). Siempre en la moneda del instrumento: convertirlo haría que cada
// movimiento del tipo de cambio pareciera una subida o un recorte.

/** Dividendo PAID de un instrumento (de cualquier cuenta del usuario). */
export type DpsDividend = {
  accountId: string;
  paymentDate: string;
  exDate: string | null;
  kind: DividendKind;
  grossAmount: Decimal;
  perShare: Decimal | null;
};

export type DpsPayment = {
  paymentDate: string;
  kind: DividendKind;
  perShare: Decimal;
  /** true = perShare informado (no derivado). */
  exact: boolean;
  /** Derivado sin exDate y con operaciones del instrumento en (pago − 45 d, pago]: poco confiable. */
  estimated: boolean;
};

/** Ventana previa al pago en que una compra o venta puede caer entre la fecha ex y el pago. */
export const ESTIMATION_WINDOW_DAYS = 45;

export type HealthStatus = 'SUSPENDED' | 'CUT' | 'DOWN' | 'INSUFFICIENT_DATA' | 'STABLE' | 'GROWING';
export type DataQuality = 'EXACT' | 'DERIVED' | 'PARTIAL';

export type DividendHealth = {
  years: Array<{ year: number; perShare: Decimal; growth: Decimal | null; partial: boolean }>;
  ttmPerShare: Decimal;
  previousTtmPerShare: Decimal;
  ttmGrowth: Decimal | null;
  cagr: Decimal | null;
  lastRegular: { paymentDate: string; perShare: Decimal; estimated: boolean } | null;
  previousRegular: { paymentDate: string; perShare: Decimal; estimated: boolean } | null;
  status: HealthStatus;
  cutReason: 'TTM' | 'LAST_REGULAR' | null;
  dataQuality: DataQuality;
};

const DPS_SCALE = 10;
const STABLE_LIMIT = Decimal.parse('0.02');

const minusDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/**
 * DPA de cada pago. Un mismo pago (fecha de pago) repartido en varias cuentas cuenta una vez. Si el
 * dividendo trae `perShare`, manda; si no, Σ bruto / cantidad total en cartera a exDate (o a la fecha de
 * pago si no hay). Con cantidad 0 a esa fecha (dato inconsistente) el pago se excluye y se cuenta.
 * Un derivado sin exDate es `estimated` si hubo operaciones del instrumento (`tradeDates`, cualquier
 * cuenta) en (pago − 45 d, pago]: la cantidad a la fecha de pago puede no ser la que cobró.
 */
export function perSharePayments(
  dividends: readonly DpsDividend[],
  quantityAt: (date: string) => Decimal,
  tradeDates: readonly string[] = [],
): { payments: DpsPayment[]; excluded: number } {
  const groups = new Map<string, DpsDividend[]>();
  for (const d of dividends) groups.set(d.paymentDate, [...(groups.get(d.paymentDate) ?? []), d]);

  const payments: DpsPayment[] = [];
  let excluded = 0;
  for (const [paymentDate, group] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const kind = group[0]!.kind;
    const informed = group.find((d) => d.perShare !== null)?.perShare ?? null;
    if (informed !== null) {
      payments.push({ paymentDate, kind, perShare: informed, exact: true, estimated: false });
      continue;
    }
    const exDate = group.find((d) => d.exDate !== null)?.exDate ?? null;
    const quantity = quantityAt(exDate ?? paymentDate);
    if (!quantity.isPositive()) {
      excluded += 1;
      continue;
    }
    const windowStart = minusDays(paymentDate, ESTIMATION_WINDOW_DAYS);
    const estimated = exDate === null && tradeDates.some((t) => t > windowStart && t <= paymentDate);
    payments.push({ paymentDate, kind, perShare: Decimal.sum(group.map((d) => d.grossAmount)).div(quantity, DPS_SCALE), exact: false, estimated });
  }
  return { payments, excluded };
}

/** Raíz n-ésima por Newton (Decimal, sin number). */
export function nthRoot(value: Decimal, n: number, scale = 20): Decimal {
  if (n === 1 || value.isZero()) return value;
  const N = Decimal.fromInt(n);
  const N1 = Decimal.fromInt(n - 1);
  let x = value.gt(Decimal.ONE) ? Decimal.ONE.add(value.sub(Decimal.ONE).div(N, scale)) : Decimal.ONE;
  for (let i = 0; i < 200; i++) {
    let power = Decimal.ONE;
    for (let k = 0; k < n - 1; k++) power = power.mul(x).round(scale);
    const next = N1.mul(x).add(value.div(power, scale)).div(N, scale);
    if (next.sub(x).abs().lte(Decimal.parse(`0.${'0'.repeat(scale - 2)}1`))) return next;
    x = next;
  }
  return x;
}

const growthOf = (current: Decimal, previous: Decimal) => (previous.isPositive() ? current.div(previous, RATE_SCALE).sub(Decimal.ONE) : null);

/**
 * Salud del dividendo de un instrumento (ver contrato /dividends/per-share). Tenencia parcial: un año en
 * que no se tuvo la posición completa queda `partial` y sin crecimiento, y el ttmGrowth es null si la
 * primera compra es posterior al inicio del TTM anterior (si no, saldría un falso "creciendo").
 */
export function dividendHealth(input: {
  payments: readonly DpsPayment[];
  excluded: number;
  firstTradeDate: string;
  today: string;
  threshold: Decimal;
}): DividendHealth {
  const { payments, firstTradeDate, today, threshold } = input;
  const currentYear = Number(today.slice(0, 4));

  const firstYear = payments.length === 0 ? null : Number(payments[0]!.paymentDate.slice(0, 4));
  const years: DividendHealth['years'] = [];
  if (firstYear !== null) {
    for (let year = firstYear; year <= currentYear; year++) {
      const perShare = Decimal.sum(payments.filter((p) => p.paymentDate.startsWith(`${year}-`)).map((p) => p.perShare));
      const partial = year === currentYear || firstTradeDate > `${year}-01-01`;
      const previous = years.at(-1);
      years.push({
        year,
        perShare,
        partial,
        growth: !partial && previous && !previous.partial && previous.year === year - 1 ? growthOf(perShare, previous.perShare) : null,
      });
    }
  }

  const ttmStart = oneYearBefore(today);
  const previousStart = oneYearBefore(ttmStart);
  const notSpecial = payments.filter((p) => p.kind !== 'SPECIAL');
  const inTtm = notSpecial.filter((p) => p.paymentDate > ttmStart && p.paymentDate <= today);
  const inPrevious = notSpecial.filter((p) => p.paymentDate > previousStart && p.paymentDate <= ttmStart);
  const ttmPerShare = Decimal.sum(inTtm.map((p) => p.perShare));
  const previousTtmPerShare = Decimal.sum(inPrevious.map((p) => p.perShare));
  const ttmGrowth = firstTradeDate <= previousStart ? growthOf(ttmPerShare, previousTtmPerShare) : null;

  const full = years.filter((y) => !y.partial);
  const cagr =
    full.length >= 2 && full[0]!.perShare.isPositive()
      ? nthRoot(full.at(-1)!.perShare.div(full[0]!.perShare, 20), full.length - 1).sub(Decimal.ONE).round(RATE_SCALE)
      : null;

  const regular = payments.filter((p) => p.kind === 'REGULAR');
  const last = regular.at(-1);
  const prev = regular.at(-2);
  // Señal temprana del último pago regular, sólo con DPA confiables (ninguno estimado).
  const regularGrowth = last && prev && !last.estimated && !prev.estimated ? growthOf(last.perShare, prev.perShare) : null;

  const minusThreshold = threshold.neg();
  let status: HealthStatus;
  let cutReason: DividendHealth['cutReason'] = null;
  if (previousTtmPerShare.isPositive() && inTtm.length === 0) status = 'SUSPENDED';
  else if (ttmGrowth !== null && ttmGrowth.lte(minusThreshold)) [status, cutReason] = ['CUT', 'TTM'];
  else if (regularGrowth !== null && regularGrowth.lte(minusThreshold)) [status, cutReason] = ['CUT', 'LAST_REGULAR'];
  else if (ttmGrowth === null) status = 'INSUFFICIENT_DATA';
  else if (ttmGrowth.isNegative()) status = 'DOWN';
  else if (ttmGrowth.lte(STABLE_LIMIT)) status = 'STABLE';
  else status = 'GROWING';

  return {
    years,
    ttmPerShare,
    previousTtmPerShare,
    ttmGrowth,
    cagr,
    lastRegular: last ? { paymentDate: last.paymentDate, perShare: last.perShare, estimated: last.estimated } : null,
    previousRegular: prev ? { paymentDate: prev.paymentDate, perShare: prev.perShare, estimated: prev.estimated } : null,
    status,
    cutReason,
    dataQuality: input.excluded > 0 ? 'PARTIAL' : payments.every((p) => p.exact) ? 'EXACT' : 'DERIVED',
  };
}

const STATUS_ORDER: HealthStatus[] = ['SUSPENDED', 'CUT', 'DOWN', 'INSUFFICIENT_DATA', 'STABLE', 'GROWING'];

/** Orden del contrato: estado y luego símbolo. */
export function sortHealthRows<T extends { status: HealthStatus; symbol: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
}
