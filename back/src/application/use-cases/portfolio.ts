import type { Currency } from '../../domain/currency.ts';
import { monthOf, oneYearBefore } from '../../domain/dates.ts';
import { Decimal } from '../../domain/decimal.ts';
import type { Dividend, DividendStatus } from '../../domain/dividend.ts';
import type { Instrument, InstrumentType } from '../../domain/instrument.ts';
import { computeHoldings, type Holding } from '../../domain/positions.ts';
import { roundAmount, RATE_SCALE } from '../../domain/amounts.ts';
import type { Clock } from '../ports/clock.ts';
import type { UnitOfWork } from '../ports/unit-of-work.ts';

export type PositionQuery = {
  groupBy: 'instrument' | 'account';
  accountId?: string | undefined;
  includeClosed: boolean;
  asOf?: string | undefined;
};

export type PositionView = {
  accountId: string | null;
  instrumentId: string;
  symbol: string;
  name: string;
  marketCode: string;
  type: InstrumentType;
  sector: string | null;
  currency: Currency;
  quantity: Decimal;
  averageCost: Decimal;
  costBasis: Decimal;
  realizedGain: Decimal;
  dividendsGross: Decimal;
  dividendsNet: Decimal;
  annualDividendPerShare: Decimal | null;
  expectedAnnualIncomeGross: Decimal | null;
  yieldOnCost: Decimal | null;
  firstTradeDate: string;
  paymentMonths: number[];
};

type Row = { gross: Decimal[]; net: Decimal[] };
export type SummaryRow = { instrumentId: string; symbol: string; monthlyGross: Decimal[]; monthlyNet: Decimal[]; totalGross: Decimal; totalNet: Decimal };
export type SummaryGroup = { currency: Currency; rows: SummaryRow[]; monthlyGross: Decimal[]; monthlyNet: Decimal[]; totalGross: Decimal; totalNet: Decimal };
export type DividendSummary = { year: number; groups: SummaryGroup[] };

const twelveZeros = () => Array.from({ length: 12 }, () => Decimal.ZERO);
const QUANTITY_SCALE = 10;

type Grouped = Omit<Holding, 'accountId'> & { accountId: string | null };

/** Suma posiciones de varias cuentas del mismo instrumento. */
function mergeByInstrument(holdings: Holding[]): Grouped[] {
  const merged = new Map<string, Grouped>();
  for (const h of holdings) {
    const m = merged.get(h.instrumentId);
    if (!m) {
      merged.set(h.instrumentId, { ...h, accountId: null });
      continue;
    }
    m.quantity = m.quantity.add(h.quantity);
    m.costBasis = m.costBasis.add(h.costBasis);
    m.realizedGain = m.realizedGain.add(h.realizedGain);
    if (h.firstTradeDate < m.firstTradeDate) m.firstTradeDate = h.firstTradeDate;
    m.averageCost = m.quantity.isZero() ? Decimal.ZERO : m.costBasis.div(m.quantity, QUANTITY_SCALE);
  }
  return [...merged.values()];
}

export class Portfolio {
  readonly #uow: UnitOfWork;
  readonly #clock: Clock;

  constructor(deps: { uow: UnitOfWork; clock: Clock }) {
    this.#uow = deps.uow;
    this.#clock = deps.clock;
  }

  positions(userId: string, query: PositionQuery): Promise<PositionView[]> {
    const asOf = query.asOf ?? this.#clock.today();
    return this.#uow.read(async (r) => {
      const [trades, dividends] = await Promise.all([
        r.trades.listByUser(userId, { accountId: query.accountId }),
        r.dividends.listByUser(userId, { accountId: query.accountId, status: 'PAID', to: asOf }),
      ]);
      const perAccount = computeHoldings(trades, asOf);
      const holdings: Grouped[] = query.groupBy === 'instrument' ? mergeByInstrument(perAccount) : perAccount;
      const instruments = new Map((await r.instruments.findByIds(holdings.map((h) => h.instrumentId))).map((i) => [i.id, i]));
      const windowStart = oneYearBefore(asOf);

      return holdings
        .filter((h) => query.includeClosed || !h.quantity.isZero())
        .map((h) => {
          const instrument = instruments.get(h.instrumentId)!;
          const own = dividends.filter(
            (d) => d.instrumentId === h.instrumentId && (h.accountId === null || d.accountId === h.accountId),
          );
          return this.#position(h, instrument, own, windowStart);
        })
        .sort((a, b) =>
          a.currency !== b.currency
            ? a.currency < b.currency ? -1 : 1
            : a.symbol !== b.symbol
              ? a.symbol < b.symbol ? -1 : 1
              : (a.accountId ?? '') < (b.accountId ?? '') ? -1 : 1,
        );
    });
  }

  #position(h: Grouped, instrument: Instrument, dividends: Dividend[], windowStart: string): PositionView {
    const adps = instrument.annualDividendPerShare;
    const months = new Set(dividends.filter((d) => d.paymentDate > windowStart).map((d) => monthOf(d.paymentDate)));
    return {
      accountId: h.accountId,
      instrumentId: instrument.id,
      symbol: instrument.symbol,
      name: instrument.name,
      marketCode: instrument.marketCode,
      type: instrument.type,
      sector: instrument.sector,
      currency: instrument.currency,
      quantity: h.quantity,
      averageCost: h.averageCost,
      costBasis: h.costBasis,
      realizedGain: h.realizedGain,
      dividendsGross: Decimal.sum(dividends.map((d) => d.grossAmount)),
      dividendsNet: Decimal.sum(dividends.map((d) => d.netAmount)),
      annualDividendPerShare: adps,
      expectedAnnualIncomeGross: adps === null ? null : roundAmount(h.quantity.mul(adps)),
      yieldOnCost: adps === null || h.averageCost.isZero() ? null : adps.div(h.averageCost, RATE_SCALE),
      firstTradeDate: h.firstTradeDate,
      paymentMonths: [...months].sort((a, b) => a - b),
    };
  }

  /** Dividendos de un año por moneda, instrumento y mes de pago (tabla mensual del Excel). */
  dividendSummary(
    userId: string,
    query: { year: number; status?: DividendStatus | undefined; accountId?: string | undefined },
  ): Promise<DividendSummary> {
    return this.#uow.read(async (r) => {
      const dividends = await r.dividends.listByUser(userId, {
        accountId: query.accountId,
        status: query.status,
        from: `${query.year}-01-01`,
        to: `${query.year}-12-31`,
      });
      const instruments = new Map((await r.instruments.findByIds(dividends.map((d) => d.instrumentId))).map((i) => [i.id, i]));

      const groups = new Map<Currency, Map<string, Row>>();
      for (const d of dividends) {
        const rows = groups.get(d.currency) ?? new Map<string, Row>();
        groups.set(d.currency, rows);
        const row = rows.get(d.instrumentId) ?? { gross: twelveZeros(), net: twelveZeros() };
        rows.set(d.instrumentId, row);
        const m = monthOf(d.paymentDate) - 1;
        row.gross[m] = row.gross[m]!.add(d.grossAmount);
        row.net[m] = row.net[m]!.add(d.netAmount);
      }

      const sumColumns = (rows: Decimal[][]) => twelveZeros().map((_, i) => Decimal.sum(rows.map((r) => r[i]!)));
      return {
        year: query.year,
        groups: [...groups.entries()]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([currency, rows]) => {
            const summaryRows: SummaryRow[] = [...rows.entries()]
              .map(([instrumentId, row]) => ({
                instrumentId,
                symbol: instruments.get(instrumentId)!.symbol,
                monthlyGross: row.gross,
                monthlyNet: row.net,
                totalGross: Decimal.sum(row.gross),
                totalNet: Decimal.sum(row.net),
              }))
              .sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
            const monthlyGross = sumColumns(summaryRows.map((s) => s.monthlyGross));
            const monthlyNet = sumColumns(summaryRows.map((s) => s.monthlyNet));
            return { currency, rows: summaryRows, monthlyGross, monthlyNet, totalGross: Decimal.sum(monthlyGross), totalNet: Decimal.sum(monthlyNet) };
          }),
      };
    });
  }
}
