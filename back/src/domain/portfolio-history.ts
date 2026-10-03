import { roundAmount } from './amounts.ts';
import type { Currency } from './currency.ts';
import { Decimal } from './decimal.ts';
import { HoldingsBook, sortTrades, type PositionTrade } from './positions.ts';

export type HistoryPoint = {
  date: string;
  /** Posiciones a precio y TC del día; las que no tienen ningún precio, a su costo vigente. */
  marketValue: Decimal;
  /** Parte de marketValue valorizada al costo por falta de precio (0 si todo tiene precio). */
  unpricedAtCost: Decimal;
  /** marketValue + cash. */
  netWorth: Decimal;
  /** netWorth − contributedCapital. */
  totalGain: Decimal;
  /** Costo vigente a TC históricos. */
  costBasis: Decimal;
  /** Caja a TC del día. */
  cash: Decimal;
  contributedCapital: Decimal;
  dividendsNetCumulative: Decimal;
  realizedGainCumulative: Decimal;
};

export type HistoryInput = {
  /** Fechas a calcular, ascendentes. */
  dates: readonly string[];
  trades: readonly PositionTrade[];
  currencyOf: (instrumentId: string) => Currency;
  movements: ReadonlyArray<{ date: string; type: string; amount: Decimal; currency: Currency }>;
  /** Dividendos PAID. */
  dividends: ReadonlyArray<{ paymentDate: string; netAmount: Decimal; currency: Currency }>;
  /** Precio de un instrumento en una fecha (último cierre en o antes; null si no hay). */
  priceAt: (instrumentId: string, date: string) => Decimal | null;
  /** Monto → moneda de reporte al TC de `date`. */
  toReporting: (amount: Decimal, currency: Currency, date: string) => Decimal;
};

/**
 * Serie histórica del portafolio calculada (no almacenada), en una sola pasada: las operaciones,
 * movimientos y dividendos se aplican en orden a medida que avanzan las fechas. Redondea igual que
 * el resumen (por cuenta + instrumento y por moneda de caja), así el punto de hoy cuadra con él.
 */
export function computePortfolioHistory(input: HistoryInput): HistoryPoint[] {
  const book = new HoldingsBook({
    toReporting: (instrumentId, amount, date) => input.toReporting(amount, input.currencyOf(instrumentId), date),
  });
  const trades = sortTrades(input.trades);
  const movements = [...input.movements].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const dividends = [...input.dividends].sort((a, b) => (a.paymentDate < b.paymentDate ? -1 : a.paymentDate > b.paymentDate ? 1 : 0));

  let ti = 0;
  let mi = 0;
  let di = 0;
  const balances = new Map<Currency, Decimal>();
  let contributed = Decimal.ZERO;
  let dividendsCum = Decimal.ZERO;
  const points: HistoryPoint[] = [];

  for (const date of input.dates) {
    for (; ti < trades.length && trades[ti]!.tradeDate <= date; ti++) book.apply(trades[ti]!);
    for (; mi < movements.length && movements[mi]!.date <= date; mi++) {
      const m = movements[mi]!;
      balances.set(m.currency, (balances.get(m.currency) ?? Decimal.ZERO).add(m.amount));
      if (m.type === 'DEPOSIT' || m.type === 'WITHDRAWAL') contributed = contributed.add(input.toReporting(m.amount, m.currency, m.date));
    }
    for (; di < dividends.length && dividends[di]!.paymentDate <= date; di++) {
      const dv = dividends[di]!;
      dividendsCum = dividendsCum.add(input.toReporting(dv.netAmount, dv.currency, dv.paymentDate));
    }

    let marketValue = Decimal.ZERO;
    let unpricedAtCost = Decimal.ZERO;
    let costBasis = Decimal.ZERO;
    let realized = Decimal.ZERO;
    for (const s of book.states()) {
      realized = realized.add(roundAmount(s.realizedRep.round(10)));
      if (s.quantity.isZero()) continue;
      costBasis = costBasis.add(roundAmount(s.costRep));
      const price = input.priceAt(s.instrumentId, date);
      // Sin ningún precio en o antes de la fecha (p. ej. un fondo sin cobertura): se valoriza a su costo
      // promedio vigente para no subestimar el patrimonio, y se informa aparte.
      const value = roundAmount(price === null ? s.cost : s.quantity.mul(price));
      const converted = roundAmount(input.toReporting(value, input.currencyOf(s.instrumentId), date));
      marketValue = marketValue.add(converted);
      if (price === null) unpricedAtCost = unpricedAtCost.add(converted);
    }
    let cash = Decimal.ZERO;
    for (const [currency, balance] of balances) cash = cash.add(roundAmount(input.toReporting(balance, currency, date)));

    const contributedCapital = roundAmount(contributed);
    points.push({
      date,
      marketValue,
      netWorth: marketValue.add(cash),
      totalGain: marketValue.add(cash).sub(contributedCapital),
      unpricedAtCost,
      costBasis,
      cash,
      contributedCapital,
      dividendsNetCumulative: roundAmount(dividendsCum),
      realizedGainCumulative: realized,
    });
  }
  return points;
}

const DAY_MS = 86_400_000;
const toDate = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Fechas de muestreo: todos los días, o el último día de cada semana (domingo) / mes; el periodo en curso termina en `to`. */
export function sampleDates(from: string, to: string, interval: 'day' | 'week' | 'month'): string[] {
  const dates: string[] = [];
  for (let ms = toDate(from); ms <= toDate(to); ms += DAY_MS) {
    const iso = toIso(ms);
    const next = new Date(ms + DAY_MS);
    const last =
      iso === to ||
      interval === 'day' ||
      (interval === 'week' && new Date(ms).getUTCDay() === 0) ||
      (interval === 'month' && next.getUTCDate() === 1);
    if (last) dates.push(iso);
  }
  return dates;
}
