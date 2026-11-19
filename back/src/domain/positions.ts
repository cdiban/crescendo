import { roundAmount, QUANTITY_SCALE } from './amounts.ts';
import { Decimal } from './decimal.ts';
import { InsufficientPositionError } from './errors.ts';
import { splitQuantity, type SplitEvent } from './split.ts';
import type { Trade } from './trade.ts';

export type PositionTrade = Pick<
  Trade,
  'accountId' | 'instrumentId' | 'side' | 'tradeDate' | 'quantity' | 'price' | 'commission' | 'commissionTax'
>;

/** Costo y ganancia en moneda de reporte, llevados en paralelo al costo en moneda original. */
export type ReportingHolding = {
  /** Compras a TC de su fecha; las ventas descargan a costo promedio en reporte. 4 decimales. */
  costBasis: Decimal;
  /** Neto de venta a TC de la venta − costo descargado en reporte (incluye efecto cambiario realizado). */
  realizedGain: Decimal;
};

/**
 * Convierte un monto en la moneda del instrumento a la moneda de reporte al TC de `date`.
 * Recibe el monto (no la tasa) para que el adaptador multiplique antes de dividir y no pierda precisión.
 */
export type ReportingConversion = { toReporting: (instrumentId: string, amount: Decimal, date: string) => Decimal };

export type Holding = {
  accountId: string;
  instrumentId: string;
  quantity: Decimal;
  /** Costo vigente (incluye comisiones de compra), 4 decimales. */
  costBasis: Decimal;
  /** costBasis / quantity, 10 decimales; 0 si la posición está cerrada. */
  averageCost: Decimal;
  realizedGain: Decimal;
  /** Σ de compras (con comisiones) en moneda original: denominador de la rentabilidad total. */
  totalBought: Decimal;
  firstTradeDate: string;
  /** Sólo si se pidió conversión. */
  reporting?: ReportingHolding;
};

// Precisión interna del costo, para no acumular redondeos venta tras venta.
const INTERNAL_SCALE = 10;

/** Orden cronológico; el mismo día las compras van antes que las ventas. Estable. */
export function sortTrades<T extends PositionTrade>(trades: readonly T[]): T[] {
  return [...trades].sort((a, b) =>
    a.tradeDate !== b.tradeDate ? (a.tradeDate < b.tradeDate ? -1 : 1) : a.side === b.side ? 0 : a.side === 'BUY' ? -1 : 1,
  );
}

export type PositionEvent = PositionTrade | SplitEvent;

export const eventDate = (e: PositionEvent): string => ('effectiveDate' in e ? e.effectiveDate : e.tradeDate);

/** Operaciones (orden de sortTrades) y splits en orden cronológico; un split va antes que las operaciones de su fecha. */
export function sortEvents(trades: readonly PositionTrade[], splits: readonly SplitEvent[] = []): PositionEvent[] {
  const sortedSplits = [...splits].sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0));
  const result: PositionEvent[] = [];
  let si = 0;
  for (const t of sortTrades(trades)) {
    for (; si < sortedSplits.length && sortedSplits[si]!.effectiveDate <= t.tradeDate; si++) result.push(sortedSplits[si]!);
    result.push(t);
  }
  return [...result, ...sortedSplits.slice(si)];
}

type HoldingState = {
  accountId: string;
  instrumentId: string;
  quantity: Decimal;
  cost: Decimal;
  bought: Decimal;
  realized: Decimal;
  first: string;
  costRep: Decimal;
  realizedRep: Decimal;
};

/**
 * Libro de posiciones incremental: aplica operaciones en orden cronológico y entrega la foto en
 * cualquier momento. Lo usan computeHoldings (una foto) y la serie histórica (una foto por día).
 */
export class HoldingsBook {
  readonly #states = new Map<string, HoldingState>();
  readonly #conversion: ReportingConversion | undefined;

  constructor(conversion?: ReportingConversion) {
    this.#conversion = conversion;
  }

  /**
   * Los eventos deben llegar en el orden de sortEvents. Un split multiplica la cantidad de todas las
   * cuentas del instrumento por su factor (10 decimales); el costo total no cambia.
   */
  apply(e: PositionEvent): void {
    if ('effectiveDate' in e) {
      for (const s of this.#states.values()) if (s.instrumentId === e.instrumentId) s.quantity = splitQuantity(s.quantity, e);
      return;
    }
    const t = e;
    const key = `${t.accountId}\u0000${t.instrumentId}`;
    let s = this.#states.get(key);
    if (!s) {
      s = {
        accountId: t.accountId,
        instrumentId: t.instrumentId,
        quantity: Decimal.ZERO,
        cost: Decimal.ZERO,
        bought: Decimal.ZERO,
        realized: Decimal.ZERO,
        first: t.tradeDate,
        costRep: Decimal.ZERO,
        realizedRep: Decimal.ZERO,
      };
      this.#states.set(key, s);
    }
    const conversion = this.#conversion;
    const gross = t.quantity.mul(t.price);
    const fees = t.commission.add(t.commissionTax);
    const toReporting = conversion ? (amount: Decimal) => conversion.toReporting(t.instrumentId, amount, t.tradeDate) : null;
    if (t.side === 'BUY') {
      const total = gross.add(fees);
      s.quantity = s.quantity.add(t.quantity);
      s.cost = s.cost.add(total);
      s.bought = s.bought.add(total);
      if (toReporting) s.costRep = s.costRep.add(toReporting(total));
      return;
    }
    if (t.quantity.gt(s.quantity)) throw new InsufficientPositionError(t.tradeDate);
    const all = t.quantity.eq(s.quantity);
    const released = all ? s.cost : s.cost.mul(t.quantity).div(s.quantity, INTERNAL_SCALE);
    s.realized = s.realized.add(gross.sub(fees)).sub(released);
    s.cost = s.cost.sub(released);
    if (toReporting) {
      const releasedRep = all ? s.costRep : s.costRep.mul(t.quantity).div(s.quantity, INTERNAL_SCALE);
      s.realizedRep = s.realizedRep.add(toReporting(gross.sub(fees))).sub(releasedRep);
      s.costRep = s.costRep.sub(releasedRep);
    }
    s.quantity = s.quantity.sub(t.quantity);
    if (s.quantity.isZero()) {
      s.cost = Decimal.ZERO;
      s.costRep = Decimal.ZERO;
    }
  }

  /** Estado interno sin redondear (para sumas diarias de la serie histórica). */
  states(): Iterable<Readonly<HoldingState>> {
    return this.#states.values();
  }

  holdings(): Holding[] {
    return [...this.#states.values()]
      .sort((a, b) => (a.accountId !== b.accountId ? (a.accountId < b.accountId ? -1 : 1) : a.instrumentId < b.instrumentId ? -1 : 1))
      .map((s) => ({
        accountId: s.accountId,
        instrumentId: s.instrumentId,
        quantity: s.quantity,
        costBasis: roundAmount(s.cost),
        averageCost: s.quantity.isZero() ? Decimal.ZERO : s.cost.div(s.quantity, QUANTITY_SCALE),
        realizedGain: roundAmount(s.realized.round(INTERNAL_SCALE)),
        totalBought: roundAmount(s.bought),
        firstTradeDate: s.first,
        ...(this.#conversion
          ? { reporting: { costBasis: roundAmount(s.costRep), realizedGain: roundAmount(s.realizedRep.round(INTERNAL_SCALE)) } }
          : {}),
      }));
  }
}

/**
 * Posiciones por cuenta + instrumento con costo promedio ponderado. Con `conversion` lleva además
 * un segundo costo promedio en moneda de reporte (cada compra a su TC; las ventas descargan la
 * misma fracción del costo en reporte que del costo original).
 */
export function computeHoldings(
  trades: readonly PositionTrade[],
  asOf?: string,
  conversion?: ReportingConversion,
  splits: readonly SplitEvent[] = [],
): Holding[] {
  const book = new HoldingsBook(conversion);
  for (const e of sortEvents(trades, splits)) {
    if (asOf === undefined || eventDate(e) <= asOf) book.apply(e);
  }
  return book.holdings();
}

type QuantityTrade = Pick<PositionTrade, 'side' | 'tradeDate' | 'quantity'>;
type QuantitySplit = Pick<SplitEvent, 'effectiveDate' | 'numerator' | 'denominator'>;

/** Cantidad al cierre de cada fecha con operaciones o splits; el split se aplica antes de las operaciones de su día. */
function closingQuantities(trades: readonly QuantityTrade[], splits: readonly QuantitySplit[]): Array<[string, Decimal]> {
  const byDate = new Map<string, Decimal>();
  for (const t of trades) {
    const delta = t.side === 'BUY' ? t.quantity : t.quantity.neg();
    byDate.set(t.tradeDate, (byDate.get(t.tradeDate) ?? Decimal.ZERO).add(delta));
  }
  for (const s of splits) if (!byDate.has(s.effectiveDate)) byDate.set(s.effectiveDate, Decimal.ZERO);
  let running = Decimal.ZERO;
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, delta]) => {
      for (const s of splits) if (s.effectiveDate === date) running = splitQuantity(running, s);
      running = running.add(delta);
      return [date, running];
    });
}

/** Primera fecha en que la cantidad al cierre queda negativa (trades y splits de una sola cuenta + instrumento). */
export function firstNegativeQuantityDate(trades: readonly QuantityTrade[], splits: readonly QuantitySplit[] = []): string | null {
  return closingQuantities(trades, splits).find(([, quantity]) => quantity.isNegative())?.[0] ?? null;
}

/** Cantidad al cierre de `date`, en las acciones vigentes en esa fecha (trades y splits de un solo instrumento). */
export function quantityAt(trades: readonly QuantityTrade[], date: string, splits: readonly QuantitySplit[] = []): Decimal {
  let result = Decimal.ZERO;
  for (const [d, quantity] of closingQuantities(trades, splits)) {
    if (d > date) break;
    result = quantity;
  }
  return result;
}
