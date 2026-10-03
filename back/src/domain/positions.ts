import { roundAmount, QUANTITY_SCALE } from './amounts.ts';
import { Decimal } from './decimal.ts';
import { InsufficientPositionError } from './errors.ts';
import type { Trade } from './trade.ts';

export type PositionTrade = Pick<
  Trade,
  'accountId' | 'instrumentId' | 'side' | 'tradeDate' | 'quantity' | 'price' | 'commission' | 'commissionTax'
>;

export type Holding = {
  accountId: string;
  instrumentId: string;
  quantity: Decimal;
  /** Costo vigente (incluye comisiones de compra), 4 decimales. */
  costBasis: Decimal;
  /** costBasis / quantity, 10 decimales; 0 si la posición está cerrada. */
  averageCost: Decimal;
  realizedGain: Decimal;
  firstTradeDate: string;
};

// Precisión interna del costo, para no acumular redondeos venta tras venta.
const INTERNAL_SCALE = 10;

/** Orden cronológico; el mismo día las compras van antes que las ventas. Estable. */
export function sortTrades<T extends PositionTrade>(trades: readonly T[]): T[] {
  return [...trades].sort((a, b) =>
    a.tradeDate !== b.tradeDate ? (a.tradeDate < b.tradeDate ? -1 : 1) : a.side === b.side ? 0 : a.side === 'BUY' ? -1 : 1,
  );
}

/** Posiciones por cuenta + instrumento con costo promedio ponderado. */
export function computeHoldings(trades: readonly PositionTrade[], asOf?: string): Holding[] {
  type State = { accountId: string; instrumentId: string; quantity: Decimal; cost: Decimal; realized: Decimal; first: string };
  const states = new Map<string, State>();

  for (const t of sortTrades(trades)) {
    if (asOf !== undefined && t.tradeDate > asOf) continue;
    const key = `${t.accountId}\u0000${t.instrumentId}`;
    let s = states.get(key);
    if (!s) {
      s = { accountId: t.accountId, instrumentId: t.instrumentId, quantity: Decimal.ZERO, cost: Decimal.ZERO, realized: Decimal.ZERO, first: t.tradeDate };
      states.set(key, s);
    }
    const gross = t.quantity.mul(t.price);
    const fees = t.commission.add(t.commissionTax);
    if (t.side === 'BUY') {
      s.quantity = s.quantity.add(t.quantity);
      s.cost = s.cost.add(gross).add(fees);
      continue;
    }
    if (t.quantity.gt(s.quantity)) throw new InsufficientPositionError(t.tradeDate);
    const released = t.quantity.eq(s.quantity) ? s.cost : s.cost.mul(t.quantity).div(s.quantity, INTERNAL_SCALE);
    s.realized = s.realized.add(gross.sub(fees)).sub(released);
    s.cost = s.cost.sub(released);
    s.quantity = s.quantity.sub(t.quantity);
    if (s.quantity.isZero()) s.cost = Decimal.ZERO;
  }

  return [...states.values()]
    .sort((a, b) => (a.accountId !== b.accountId ? (a.accountId < b.accountId ? -1 : 1) : a.instrumentId < b.instrumentId ? -1 : 1))
    .map((s) => ({
      accountId: s.accountId,
      instrumentId: s.instrumentId,
      quantity: s.quantity,
      costBasis: roundAmount(s.cost),
      averageCost: s.quantity.isZero() ? Decimal.ZERO : s.cost.div(s.quantity, QUANTITY_SCALE),
      realizedGain: roundAmount(s.realized.round(INTERNAL_SCALE)),
      firstTradeDate: s.first,
    }));
}

type QuantityTrade = Pick<PositionTrade, 'side' | 'tradeDate' | 'quantity'>;

function closingQuantities(trades: readonly QuantityTrade[]): Array<[string, Decimal]> {
  const byDate = new Map<string, Decimal>();
  for (const t of trades) {
    const delta = t.side === 'BUY' ? t.quantity : t.quantity.neg();
    byDate.set(t.tradeDate, (byDate.get(t.tradeDate) ?? Decimal.ZERO).add(delta));
  }
  let running = Decimal.ZERO;
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, delta]) => {
      running = running.add(delta);
      return [date, running];
    });
}

/** Primera fecha en que la cantidad al cierre queda negativa (trades de una sola cuenta + instrumento). */
export function firstNegativeQuantityDate(trades: readonly QuantityTrade[]): string | null {
  return closingQuantities(trades).find(([, quantity]) => quantity.isNegative())?.[0] ?? null;
}

/** Cantidad al cierre de `date` (trades de una sola cuenta + instrumento). */
export function quantityAt(trades: readonly QuantityTrade[], date: string): Decimal {
  let result = Decimal.ZERO;
  for (const [d, quantity] of closingQuantities(trades)) {
    if (d > date) break;
    result = quantity;
  }
  return result;
}
