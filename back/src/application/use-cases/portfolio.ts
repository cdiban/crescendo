import { roundAmount, RATE_SCALE } from '../../domain/amounts.ts';
import type { Currency } from '../../domain/currency.ts';
import { monthOf, oneYearBefore } from '../../domain/dates.ts';
import { Decimal } from '../../domain/decimal.ts';
import type { Dividend, DividendStatus } from '../../domain/dividend.ts';
import { FX_CURRENCIES, FxTable } from '../../domain/fx.ts';
import type { Instrument, InstrumentType } from '../../domain/instrument.ts';
import { computeHoldings, type Holding } from '../../domain/positions.ts';
import { cashFxEffect, exposureWeights, type Exposure } from '../../domain/reporting.ts';
import { NotFoundError } from '../errors.ts';
import type { Clock } from '../ports/clock.ts';
import type { Repositories } from '../ports/repositories.ts';
import type { UnitOfWork } from '../ports/unit-of-work.ts';

export type PositionQuery = {
  groupBy: 'instrument' | 'account';
  accountId?: string | undefined;
  includeClosed: boolean;
  asOf?: string | undefined;
  reportingCurrency?: Currency | undefined;
};

/** Montos de una posición (o suma) en moneda de reporte. Invariante: costBasisAtCurrentRate − costBasis = fxEffect. */
export type ReportingAmounts = {
  currency: Currency;
  costBasis: Decimal;
  costBasisAtCurrentRate: Decimal;
  fxEffect: Decimal;
  realizedGain: Decimal;
  dividendsNet: Decimal;
  expectedAnnualIncomeGross: Decimal | null;
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
  reporting: ReportingAmounts;
};

export type PositionTotals = {
  currency: Currency;
  costBasis: Decimal;
  realizedGain: Decimal;
  dividendsGross: Decimal;
  dividendsNet: Decimal;
  expectedAnnualIncomeGross: Decimal;
};

export type PositionsResult = {
  reportingCurrency: Currency;
  fxAsOf: string;
  items: PositionView[];
  totalsByCurrency: PositionTotals[];
  total: ReportingAmounts;
};

export type SummaryRow = { instrumentId: string; symbol: string; monthlyGross: Decimal[]; monthlyNet: Decimal[]; totalGross: Decimal; totalNet: Decimal };
export type SummaryGroup = { currency: Currency; rows: SummaryRow[]; monthlyGross: Decimal[]; monthlyNet: Decimal[]; totalGross: Decimal; totalNet: Decimal };
export type ReportingMonthly = { currency: Currency; monthlyGross: Decimal[]; monthlyNet: Decimal[]; totalGross: Decimal; totalNet: Decimal };
export type DividendSummary = { year: number; groups: SummaryGroup[]; reporting: ReportingMonthly };

export type PortfolioSummary = {
  reportingCurrency: Currency;
  asOf: string;
  fxAsOf: string;
  contributedCapital: Decimal;
  costBasis: Decimal;
  costBasisAtCurrentRate: Decimal;
  cash: Decimal;
  fxEffect: { positions: Decimal; cash: Decimal; total: Decimal };
  realizedGain: Decimal;
  dividends: { netYearToDate: Decimal; netLast12Months: Decimal; netTotal: Decimal; expectedAnnualGross: Decimal };
  exposure: Exposure[];
};

const twelveZeros = () => Array.from({ length: 12 }, () => Decimal.ZERO);
const QUANTITY_SCALE = 10;

type Row = Omit<Holding, 'accountId' | 'reporting'> & { accountId: string | null; reporting: { costBasis: Decimal; realizedGain: Decimal } };

/** Suma posiciones de varias cuentas del mismo instrumento (también en moneda de reporte). */
function mergeByInstrument(holdings: Row[]): Row[] {
  const merged = new Map<string, Row>();
  for (const h of holdings) {
    const m = merged.get(h.instrumentId);
    if (!m) {
      merged.set(h.instrumentId, { ...h, accountId: null, reporting: { ...h.reporting } });
      continue;
    }
    m.quantity = m.quantity.add(h.quantity);
    m.costBasis = m.costBasis.add(h.costBasis);
    m.realizedGain = m.realizedGain.add(h.realizedGain);
    m.reporting.costBasis = m.reporting.costBasis.add(h.reporting.costBasis);
    m.reporting.realizedGain = m.reporting.realizedGain.add(h.reporting.realizedGain);
    if (h.firstTradeDate < m.firstTradeDate) m.firstTradeDate = h.firstTradeDate;
    m.averageCost = m.quantity.isZero() ? Decimal.ZERO : m.costBasis.div(m.quantity, QUANTITY_SCALE);
  }
  return [...merged.values()];
}

/** Conversión a la moneda de reporte con los TC cargados hasta `asOf` ("actual" = último en o antes de asOf). */
class Reporter {
  readonly currency: Currency;
  readonly asOf: string;
  readonly #fx: FxTable;

  constructor(fx: FxTable, currency: Currency, asOf: string) {
    this.#fx = fx;
    this.currency = currency;
    this.asOf = asOf;
  }

  /** Al TC de `date` (fechas futuras usan el último disponible hasta asOf). */
  atDate(amount: Decimal, from: Currency, date: string): Decimal {
    return this.#fx.convert(amount, from, this.currency, date > this.asOf ? this.asOf : date);
  }

  atCurrent(amount: Decimal, from: Currency): Decimal {
    return this.#fx.convert(amount, from, this.currency, this.asOf);
  }

  /** Fecha del último TC usado como "actual" entre las monedas involucradas. */
  fxAsOf(currencies: Iterable<Currency>): string {
    const dates = [...new Set([...currencies, this.currency])]
      .map((c) => this.#fx.latestDate(c, this.asOf))
      .filter((d): d is string => d !== null);
    if (dates.length > 0) return dates.sort().at(-1)!;
    // Todo en la misma moneda (sin conversión): la fecha del último dato cargado, o asOf si no hay ninguno.
    const any = FX_CURRENCIES.map((c) => this.#fx.latestDate(c, this.asOf)).filter((d): d is string => d !== null);
    return any.sort().at(-1) ?? this.asOf;
  }
}

function sumReporting(currency: Currency, rows: ReportingAmounts[]): ReportingAmounts {
  const expected = rows.map((r) => r.expectedAnnualIncomeGross).filter((x): x is Decimal => x !== null);
  return {
    currency,
    costBasis: Decimal.sum(rows.map((r) => r.costBasis)),
    costBasisAtCurrentRate: Decimal.sum(rows.map((r) => r.costBasisAtCurrentRate)),
    fxEffect: Decimal.sum(rows.map((r) => r.fxEffect)),
    realizedGain: Decimal.sum(rows.map((r) => r.realizedGain)),
    dividendsNet: Decimal.sum(rows.map((r) => r.dividendsNet)),
    expectedAnnualIncomeGross: expected.length === 0 ? null : Decimal.sum(expected),
  };
}

export class Portfolio {
  readonly #uow: UnitOfWork;
  readonly #clock: Clock;

  constructor(deps: { uow: UnitOfWork; clock: Clock }) {
    this.#uow = deps.uow;
    this.#clock = deps.clock;
  }

  async #reportingCurrency(r: Repositories, userId: string, requested: Currency | undefined): Promise<Currency> {
    if (requested) return requested;
    const user = await r.users.findById(userId);
    if (!user) throw new NotFoundError('El usuario');
    return user.reportingCurrency;
  }

  async #reporter(r: Repositories, userId: string, requested: Currency | undefined, asOf: string): Promise<Reporter> {
    const [currency, quotes] = await Promise.all([this.#reportingCurrency(r, userId, requested), r.fxRates.listUpTo(asOf)]);
    return new Reporter(new FxTable(quotes), currency, asOf);
  }

  /** Filas de posición (incluidas las cerradas) con sus montos en reporte. */
  async #rows(r: Repositories, userId: string, rep: Reporter, query: Omit<PositionQuery, 'includeClosed' | 'reportingCurrency'>) {
    const asOf = rep.asOf;
    const [trades, dividends] = await Promise.all([
      r.trades.listByUser(userId, { accountId: query.accountId }),
      r.dividends.listByUser(userId, { accountId: query.accountId, status: 'PAID', to: asOf }),
    ]);
    const instruments = new Map((await r.instruments.findByIds([...new Set(trades.map((t) => t.instrumentId))])).map((i) => [i.id, i]));
    const perAccount = computeHoldings(trades, asOf, {
      toReporting: (instrumentId, amount, date) => rep.atDate(amount, instruments.get(instrumentId)!.currency, date),
    }) as Row[];
    const holdings = query.groupBy === 'instrument' ? mergeByInstrument(perAccount) : perAccount;
    const windowStart = oneYearBefore(asOf);

    const views = holdings.map((h) => {
      const instrument = instruments.get(h.instrumentId)!;
      const own = dividends.filter((d) => d.instrumentId === h.instrumentId && (h.accountId === null || d.accountId === h.accountId));
      return this.#position(h, instrument, own, windowStart, rep);
    });
    return { views, instruments };
  }

  positions(userId: string, query: PositionQuery): Promise<PositionsResult> {
    const asOf = query.asOf ?? this.#clock.today();
    return this.#uow.read(async (r) => {
      const rep = await this.#reporter(r, userId, query.reportingCurrency, asOf);
      const { views } = await this.#rows(r, userId, rep, query);
      const items = views
        .filter((p) => query.includeClosed || !p.quantity.isZero())
        .sort((a, b) =>
          a.currency !== b.currency
            ? a.currency < b.currency ? -1 : 1
            : a.symbol !== b.symbol
              ? a.symbol < b.symbol ? -1 : 1
              : (a.accountId ?? '') < (b.accountId ?? '') ? -1 : 1,
        );

      const currencies = [...new Set(items.map((p) => p.currency))].sort();
      const totalsByCurrency = currencies.map((currency) => {
        const rows = items.filter((p) => p.currency === currency);
        return {
          currency,
          costBasis: Decimal.sum(rows.map((p) => p.costBasis)),
          realizedGain: Decimal.sum(rows.map((p) => p.realizedGain)),
          dividendsGross: Decimal.sum(rows.map((p) => p.dividendsGross)),
          dividendsNet: Decimal.sum(rows.map((p) => p.dividendsNet)),
          expectedAnnualIncomeGross: Decimal.sum(rows.map((p) => p.expectedAnnualIncomeGross).filter((x): x is Decimal => x !== null)),
        };
      });
      return {
        reportingCurrency: rep.currency,
        fxAsOf: rep.fxAsOf(views.map((p) => p.currency)),
        items,
        totalsByCurrency,
        total: sumReporting(rep.currency, items.map((p) => p.reporting)),
      };
    });
  }

  #position(h: Row, instrument: Instrument, dividends: Dividend[], windowStart: string, rep: Reporter): PositionView {
    const adps = instrument.annualDividendPerShare;
    const months = new Set(dividends.filter((d) => d.paymentDate > windowStart).map((d) => monthOf(d.paymentDate)));
    const expected = adps === null ? null : roundAmount(h.quantity.mul(adps));
    const costBasisAtCurrentRate = roundAmount(rep.atCurrent(h.costBasis, instrument.currency));
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
      expectedAnnualIncomeGross: expected,
      yieldOnCost: adps === null || h.averageCost.isZero() ? null : adps.div(h.averageCost, RATE_SCALE),
      firstTradeDate: h.firstTradeDate,
      paymentMonths: [...months].sort((a, b) => a - b),
      reporting: {
        currency: rep.currency,
        costBasis: h.reporting.costBasis,
        costBasisAtCurrentRate,
        // Restando los valores ya redondeados, el invariante se cumple exacto en cada fila y en las sumas.
        fxEffect: costBasisAtCurrentRate.sub(h.reporting.costBasis),
        realizedGain: h.reporting.realizedGain,
        dividendsNet: roundAmount(Decimal.sum(dividends.map((d) => rep.atDate(d.netAmount, d.currency, d.paymentDate)))),
        expectedAnnualIncomeGross: expected === null ? null : roundAmount(rep.atCurrent(expected, instrument.currency)),
      },
    };
  }

  /** Indicadores consolidados en moneda de reporte. */
  summary(userId: string, query: { reportingCurrency?: Currency | undefined; asOf?: string | undefined }): Promise<PortfolioSummary> {
    const asOf = query.asOf ?? this.#clock.today();
    return this.#uow.read(async (r) => {
      const rep = await this.#reporter(r, userId, query.reportingCurrency, asOf);
      const [{ views }, movements, dividends] = await Promise.all([
        this.#rows(r, userId, rep, { groupBy: 'account' }),
        r.cashMovements.listByUser(userId, { to: asOf }),
        r.dividends.listByUser(userId, { status: 'PAID', to: asOf }),
      ]);
      const open = views.filter((p) => !p.quantity.isZero());
      const positions = sumReporting(rep.currency, open.map((p) => p.reporting));
      const realizedGain = Decimal.sum(views.map((p) => p.reporting.realizedGain));

      const cash = cashFxEffect(movements, { atDate: (a, c, d) => rep.atDate(a, c, d), atCurrent: (a, c) => rep.atCurrent(a, c) });
      const cashTotal = Decimal.sum(cash.map((c) => c.balanceAtCurrentRate));
      const cashFx = Decimal.sum(cash.map((c) => c.fxEffect));

      const contributed = roundAmount(
        Decimal.sum(movements.filter((m) => m.type === 'DEPOSIT' || m.type === 'WITHDRAWAL').map((m) => rep.atDate(m.amount, m.currency, m.date))),
      );

      const netAt = (list: Dividend[]) => roundAmount(Decimal.sum(list.map((d) => rep.atDate(d.netAmount, d.currency, d.paymentDate))));
      const yearStart = `${asOf.slice(0, 4)}-01-01`;
      const windowStart = oneYearBefore(asOf);

      const exposure = exposureWeights([
        ...open.map((p) => ({ currency: p.currency, amount: p.reporting.costBasisAtCurrentRate })),
        ...cash.map((c) => ({ currency: c.currency, amount: c.balanceAtCurrentRate })),
      ]);

      return {
        reportingCurrency: rep.currency,
        asOf,
        fxAsOf: rep.fxAsOf([...views.map((p) => p.currency), ...cash.map((c) => c.currency)]),
        contributedCapital: contributed,
        costBasis: positions.costBasis,
        costBasisAtCurrentRate: positions.costBasisAtCurrentRate,
        cash: cashTotal,
        fxEffect: { positions: positions.fxEffect, cash: cashFx, total: positions.fxEffect.add(cashFx) },
        realizedGain,
        dividends: {
          netYearToDate: netAt(dividends.filter((d) => d.paymentDate >= yearStart)),
          netLast12Months: netAt(dividends.filter((d) => d.paymentDate > windowStart)),
          netTotal: netAt(dividends),
          expectedAnnualGross: positions.expectedAnnualIncomeGross ?? Decimal.ZERO,
        },
        exposure,
      };
    });
  }

  /** Dividendos de un año por moneda, instrumento y mes de pago, más el total en moneda de reporte. */
  dividendSummary(
    userId: string,
    query: { year: number; status?: DividendStatus | undefined; accountId?: string | undefined; reportingCurrency?: Currency | undefined },
  ): Promise<DividendSummary> {
    return this.#uow.read(async (r) => {
      const dividends = await r.dividends.listByUser(userId, {
        accountId: query.accountId,
        status: query.status,
        from: `${query.year}-01-01`,
        to: `${query.year}-12-31`,
      });
      // Los ANNOUNCED con fecha futura usan el último TC disponible (hoy).
      const rep = await this.#reporter(r, userId, query.reportingCurrency, this.#clock.today());
      const instruments = new Map((await r.instruments.findByIds(dividends.map((d) => d.instrumentId))).map((i) => [i.id, i]));

      const groups = new Map<Currency, Map<string, { gross: Decimal[]; net: Decimal[] }>>();
      const repGross = twelveZeros();
      const repNet = twelveZeros();
      for (const d of dividends) {
        const rows = groups.get(d.currency) ?? new Map<string, { gross: Decimal[]; net: Decimal[] }>();
        groups.set(d.currency, rows);
        const row = rows.get(d.instrumentId) ?? { gross: twelveZeros(), net: twelveZeros() };
        rows.set(d.instrumentId, row);
        const m = monthOf(d.paymentDate) - 1;
        row.gross[m] = row.gross[m]!.add(d.grossAmount);
        row.net[m] = row.net[m]!.add(d.netAmount);
        repGross[m] = repGross[m]!.add(rep.atDate(d.grossAmount, d.currency, d.paymentDate));
        repNet[m] = repNet[m]!.add(rep.atDate(d.netAmount, d.currency, d.paymentDate));
      }

      const sumColumns = (rows: Decimal[][]) => twelveZeros().map((_, i) => Decimal.sum(rows.map((r) => r[i]!)));
      const monthlyGross = repGross.map(roundAmount);
      const monthlyNet = repNet.map(roundAmount);
      return {
        year: query.year,
        reporting: { currency: rep.currency, monthlyGross, monthlyNet, totalGross: Decimal.sum(monthlyGross), totalNet: Decimal.sum(monthlyNet) },
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
            const g = sumColumns(summaryRows.map((s) => s.monthlyGross));
            const n = sumColumns(summaryRows.map((s) => s.monthlyNet));
            return { currency, rows: summaryRows, monthlyGross: g, monthlyNet: n, totalGross: Decimal.sum(g), totalNet: Decimal.sum(n) };
          }),
      };
    });
  }
}
