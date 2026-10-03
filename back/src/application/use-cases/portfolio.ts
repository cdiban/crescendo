import { roundAmount, RATE_SCALE } from '../../domain/amounts.ts';
import type { Currency, Money } from '../../domain/currency.ts';
import { monthOf, oneYearBefore } from '../../domain/dates.ts';
import { Decimal } from '../../domain/decimal.ts';
import type { Dividend, DividendStatus } from '../../domain/dividend.ts';
import { FX_CURRENCIES, FxTable } from '../../domain/fx.ts';
import type { Instrument, InstrumentType } from '../../domain/instrument.ts';
import { computeHoldings, type Holding } from '../../domain/positions.ts';
import { cashFxEffect, exposureWeights, WEIGHT_SCALE, type Exposure } from '../../domain/reporting.ts';
import { isIntradayPrice, type PriceSource } from '../../domain/market-data.ts';
import { effectiveWithholdingRate } from '../../domain/instrument.ts';
import { dividendsByMonth, type MonthPoint, type YearTotal } from '../../domain/dividend-stats.ts';
import { buildCalendar, estimateNextDividend, type CalendarItem, type CalendarMonth } from '../../domain/dividend-calendar.ts';
import { allocate, type AllocationItem, type AllocationRow } from '../../domain/allocation.ts';
import { simulateSnowball, type SnowballYear } from '../../domain/snowball.ts';
import { isUnassignedImportDeposit } from '../../domain/cash-movement.ts';
import { quantityAt } from '../../domain/positions.ts';
import { computePortfolioHistory, sampleDates, type HistoryPoint } from '../../domain/portfolio-history.ts';
import { reportingMarketValue, valuePosition } from '../../domain/valuation.ts';
import { ValidationError } from '../errors.ts';
import { closeOnOrBefore, resolvePrice, type CurrentPrice } from './pricing.ts';
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
  /** (v0.4) Con precio: marketValue − costBasis = unrealizedGain = priceEffect + fxEffect. */
  marketValue: Decimal | null;
  priceEffect: Decimal | null;
  unrealizedGain: Decimal | null;
  /** Interno (no se expone por fila): ingreso esperado neto de retención, a TC actual. */
  expectedAnnualIncomeNet?: Decimal | null;
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
  marketPrice: Decimal | null;
  priceAsOf: Date | null;
  /** Fecha de negocio del precio (zona del mercado). */
  priceDate: string | null;
  priceIsIntraday: boolean;
  priceSource: PriceSource | null;
  marketValue: Decimal | null;
  unrealizedGain: Decimal | null;
  unrealizedReturn: Decimal | null;
  totalReturn: Decimal | null;
  currentYield: Decimal | null;
  dayChange: Decimal | null;
};

export type PositionTotals = {
  currency: Currency;
  costBasis: Decimal;
  realizedGain: Decimal;
  dividendsGross: Decimal;
  dividendsNet: Decimal;
  expectedAnnualIncomeGross: Decimal;
  marketValue: Decimal;
  unrealizedGain: Decimal;
  pricedCoverage: Decimal;
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
  dividends: {
    netYearToDate: Decimal;
    netLast12Months: Decimal;
    netTotal: Decimal;
    expectedAnnualGross: Decimal;
    currentYield: Decimal | null;
    /** Σ cantidad × dividendo anual por acción × (1 − retención efectiva), a TC actual. */
    expectedAnnualNet: Decimal;
  };
  exposure: Exposure[];
  marketValue: Decimal;
  netWorth: Decimal;
  priceEffect: Decimal;
  unrealizedGain: Decimal;
  totalGain: Decimal;
  pricedCoverage: Decimal;
  pricesAsOf: Date | null;
  pricesDate: string | null;
  incomeGoal: { goal: Money; monthlyGoalReporting: Decimal; coverageLast12Months: Decimal; coverageExpected: Decimal } | null;
};

export type DividendsMonthly = { reportingCurrency: Currency; months: MonthPoint[]; years: YearTotal[] };
export type DividendCalendar = { reportingCurrency: Currency; months: CalendarMonth[]; totalNet: Decimal };
export type AllocationDimension = 'instrument' | 'sector' | 'market' | 'currency' | 'account' | 'type';
export type Allocation = { by: AllocationDimension; reportingCurrency: Currency; total: Decimal; items: AllocationItem[] };
export type SnowballQuery = {
  reportingCurrency?: Currency | undefined;
  years?: number | undefined;
  monthlyContribution?: Decimal | undefined;
  contributionGrowth?: Decimal | undefined;
  reinvestDividends?: boolean | undefined;
  dividendGrowth?: Decimal | undefined;
  priceGrowth?: Decimal | undefined;
};
export type SnowballProjection = {
  reportingCurrency: Currency;
  assumptions: {
    years: number;
    monthlyContribution: Decimal;
    contributionGrowth: Decimal;
    reinvestDividends: boolean;
    dividendGrowth: Decimal;
    priceGrowth: Decimal;
    startYield: Decimal;
  };
  start: { netWorth: Decimal; annualDividendsNet: Decimal };
  years: SnowballYear[];
  goalReachedYear: number | null;
};

/** Defaults de la proyección (contrato v0.5). */
export const SNOWBALL_DEFAULTS = { years: 20, contributionGrowth: '0', reinvestDividends: true, dividendGrowth: '0.05', priceGrowth: '0.04' } as const;

export type HistoryQuery = {
  reportingCurrency?: Currency | undefined;
  from?: string | undefined;
  to?: string | undefined;
  interval: 'day' | 'week' | 'month';
};

export const MAX_HISTORY_POINTS = 4000;

/** Fracción del costo con precio (1 si no hay costo). */
function coverage(priced: Decimal, total: Decimal): Decimal {
  return total.isZero() ? Decimal.ONE : priced.div(total, WEIGHT_SCALE);
}

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
    m.totalBought = m.totalBought.add(h.totalBought);
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
  const priced = rows.filter((r) => r.marketValue !== null);
  const sumOrNull = (pick: (r: ReportingAmounts) => Decimal | null) => (priced.length === 0 ? null : Decimal.sum(priced.map((r) => pick(r)!)));
  return {
    marketValue: sumOrNull((r) => r.marketValue),
    priceEffect: sumOrNull((r) => r.priceEffect),
    unrealizedGain: sumOrNull((r) => r.unrealizedGain),
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
    const ids = [...instruments.keys()];
    const [quotes, closes, markets] = await Promise.all([r.prices.quotes(ids), r.prices.latestCloses(ids, asOf), r.markets.list()]);
    const marketByCode = new Map(markets.map((m) => [m.code, m]));
    const prices = new Map(ids.map((id) => [id, resolvePrice(quotes.get(id), closes.get(id), asOf)]));
    const holdings = query.groupBy === 'instrument' ? mergeByInstrument(perAccount) : perAccount;
    const windowStart = oneYearBefore(asOf);

    const views = holdings.map((h) => {
      const instrument = instruments.get(h.instrumentId)!;
      const own = dividends.filter((d) => d.instrumentId === h.instrumentId && (h.accountId === null || d.accountId === h.accountId));
      const rate = effectiveWithholdingRate(instrument, marketByCode.get(instrument.marketCode)!);
      return this.#position(h, instrument, own, windowStart, rep, prices.get(h.instrumentId) ?? null, rate);
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
          marketValue: Decimal.sum(rows.map((p) => p.marketValue).filter((x): x is Decimal => x !== null)),
          unrealizedGain: Decimal.sum(rows.map((p) => p.unrealizedGain).filter((x): x is Decimal => x !== null)),
          pricedCoverage: coverage(
            Decimal.sum(rows.filter((p) => p.marketValue !== null).map((p) => p.costBasis)),
            Decimal.sum(rows.map((p) => p.costBasis)),
          ),
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

  #position(
    h: Row,
    instrument: Instrument,
    dividends: Dividend[],
    windowStart: string,
    rep: Reporter,
    price: CurrentPrice | null,
    withholdingRate: Decimal,
  ): PositionView {
    const adps = instrument.annualDividendPerShare;
    const months = new Set(dividends.filter((d) => d.paymentDate > windowStart).map((d) => monthOf(d.paymentDate)));
    const expected = adps === null ? null : roundAmount(h.quantity.mul(adps));
    const costBasisAtCurrentRate = roundAmount(rep.atCurrent(h.costBasis, instrument.currency));
    const dividendsNet = Decimal.sum(dividends.map((d) => d.netAmount));
    const valuation = valuePosition({
      quantity: h.quantity,
      costBasis: h.costBasis,
      realizedGain: h.realizedGain,
      dividendsNet,
      totalBought: h.totalBought,
      annualDividendPerShare: adps,
      price: price?.price ?? null,
      previousClose: price?.previousClose ?? null,
    });
    const market = reportingMarketValue({
      marketValue: valuation.marketValue,
      toCurrent: (amount) => rep.atCurrent(amount, instrument.currency),
      costBasis: h.reporting.costBasis,
      costBasisAtCurrentRate,
    });
    return {
      marketPrice: price?.price ?? null,
      priceAsOf: price?.asOf ?? null,
      priceDate: price?.date ?? null,
      priceIsIntraday: price ? isIntradayPrice({ ...price, marketCode: instrument.marketCode }, this.#clock.now()) : false,
      priceSource: price?.source ?? null,
      ...valuation,
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
      dividendsNet,
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
        expectedAnnualIncomeNet:
          expected === null ? null : roundAmount(rep.atCurrent(roundAmount(expected.mul(Decimal.ONE.sub(withholdingRate))), instrument.currency)),
        ...market,
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

      const priced = open.filter((p) => p.reporting.marketValue !== null);
      const marketValue = Decimal.sum(priced.map((p) => p.reporting.marketValue!));
      const priceEffect = Decimal.sum(priced.map((p) => p.reporting.priceEffect!));
      const unrealizedGain = Decimal.sum(priced.map((p) => p.reporting.unrealizedGain!));
      const netWorth = marketValue.add(cashTotal);
      const oldest = [...priced].sort((a, b) => a.priceAsOf!.getTime() - b.priceAsOf!.getTime())[0];
      const pricesAsOf = oldest?.priceAsOf ?? null;
      const expectedAnnualNet = Decimal.sum(open.map((p) => p.reporting.expectedAnnualIncomeNet ?? Decimal.ZERO));
      const user = (await r.users.findById(userId))!;
      const expectedAnnualGross = positions.expectedAnnualIncomeGross ?? Decimal.ZERO;

      return {
        reportingCurrency: rep.currency,
        asOf,
        fxAsOf: rep.fxAsOf([...views.map((p) => p.currency), ...cash.map((c) => c.currency)]),
        marketValue,
        netWorth,
        priceEffect,
        unrealizedGain,
        totalGain: netWorth.sub(contributed),
        pricedCoverage: coverage(Decimal.sum(priced.map((p) => p.reporting.costBasis)), positions.costBasis),
        pricesAsOf,
        pricesDate: oldest?.priceDate ?? null,
        incomeGoal: this.#incomeGoal(user.monthlyIncomeGoal, rep, netAt(dividends.filter((d) => d.paymentDate > windowStart)), expectedAnnualNet),
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
          expectedAnnualGross,
          currentYield: marketValue.isZero() ? null : expectedAnnualGross.div(marketValue, RATE_SCALE),
          expectedAnnualNet,
        },
        exposure,
      };
    });
  }

  /**
   * Calendario de 12 meses: anunciados registrados + estimados (cada PAID de los últimos 12 meses de una
   * posición abierta, proyectado al mismo día del año siguiente con la cantidad actual).
   */
  dividendCalendar(userId: string, query: { reportingCurrency?: Currency | undefined }): Promise<DividendCalendar> {
    const today = this.#clock.today();
    return this.#uow.read(async (r) => {
      const rep = await this.#reporter(r, userId, query.reportingCurrency, today);
      const [trades, announced, paid, markets] = await Promise.all([
        r.trades.listByUser(userId),
        r.dividends.listByUser(userId, { status: 'ANNOUNCED' }),
        r.dividends.listByUser(userId, { status: 'PAID', from: oneYearBefore(today), to: today }),
        r.markets.list(),
      ]);
      const ids = [...new Set([...trades, ...announced].map((x) => x.instrumentId))];
      const instruments = new Map((await r.instruments.findByIds(ids)).map((i) => [i.id, i]));
      const marketByCode = new Map(markets.map((m) => [m.code, m]));
      const holdings = new Map(computeHoldings(trades, today).map((h) => [`${h.accountId}|${h.instrumentId}`, h.quantity]));
      const item = (instrumentId: string, status: CalendarItem['status'], date: string, net: Decimal): CalendarItem => {
        const instrument = instruments.get(instrumentId)!;
        return {
          instrumentId,
          symbol: instrument.symbol,
          status,
          date,
          currency: instrument.currency,
          netAmount: net,
          netAmountReporting: roundAmount(rep.atDate(net, instrument.currency, date)),
        };
      };

      const estimated: CalendarItem[] = [];
      for (const d of paid) {
        if (d.paymentDate <= oneYearBefore(today)) continue;
        const quantityNow = holdings.get(`${d.accountId}|${d.instrumentId}`);
        if (!quantityNow?.isPositive()) continue;
        const instrument = instruments.get(d.instrumentId)!;
        const accountTrades = trades.filter((t) => t.accountId === d.accountId && t.instrumentId === d.instrumentId);
        const estimate = estimateNextDividend(
          { paymentDate: d.paymentDate, perShare: d.perShare, grossAmount: d.grossAmount, quantityThen: d.quantity ?? quantityAt(accountTrades, d.exDate ?? d.paymentDate) },
          { quantityNow, withholdingRate: effectiveWithholdingRate(instrument, marketByCode.get(instrument.marketCode)!) },
        );
        if (estimate) estimated.push(item(d.instrumentId, 'ESTIMATED', estimate.date, estimate.netAmount));
      }
      const calendar = buildCalendar({
        today,
        announced: announced.map((d) => item(d.instrumentId, 'ANNOUNCED', d.paymentDate, d.netAmount)),
        estimated,
      });
      return { reportingCurrency: rep.currency, ...calendar };
    });
  }

  /** Distribución del valor de las posiciones abiertas (sin precio → al costo, marcado) y del ingreso esperado. */
  allocation(userId: string, query: { by: AllocationDimension; reportingCurrency?: Currency | undefined; limit?: number | undefined }): Promise<Allocation> {
    const asOf = this.#clock.today();
    return this.#uow.read(async (r) => {
      const rep = await this.#reporter(r, userId, query.reportingCurrency, asOf);
      const { views, instruments } = await this.#rows(r, userId, rep, { groupBy: 'account' });
      const [accounts, markets] = await Promise.all([r.accounts.listByUser(userId), r.markets.list()]);
      const accountName = new Map(accounts.map((a) => [a.id, a.name]));
      const marketName = new Map(markets.map((m) => [m.code, m.name]));
      const group = (p: PositionView): { key: string; label: string } => {
        const instrument = instruments.get(p.instrumentId)!;
        switch (query.by) {
          case 'instrument':
            return { key: p.instrumentId, label: p.symbol };
          case 'sector':
            return { key: instrument.sector ?? '__none', label: instrument.sector ?? 'Sin sector' };
          case 'market':
            return { key: p.marketCode, label: marketName.get(p.marketCode) ?? p.marketCode };
          case 'currency':
            return { key: p.currency, label: p.currency };
          case 'account':
            return { key: p.accountId!, label: accountName.get(p.accountId!) ?? p.accountId! };
          case 'type':
            return { key: p.type, label: p.type };
        }
      };
      const rows: AllocationRow[] = views
        .filter((p) => !p.quantity.isZero())
        .map((p) => {
          const atCost = p.reporting.marketValue === null;
          const value = p.reporting.marketValue ?? p.reporting.costBasisAtCurrentRate;
          return { ...group(p), value, valuedAtCost: atCost ? value : Decimal.ZERO, income: p.reporting.expectedAnnualIncomeGross ?? Decimal.ZERO };
        });
      return { by: query.by, reportingCurrency: rep.currency, ...allocate(rows, query.limit) };
    });
  }

  /** P1: proyección "bola de nieve" desde el patrimonio y el yield neto actuales. */
  async snowball(userId: string, query: SnowballQuery): Promise<SnowballProjection> {
    const today = this.#clock.today();
    const summary = await this.summary(userId, { reportingCurrency: query.reportingCurrency, asOf: today });
    const defaultContribution = await this.#uow.read(async (r) => {
      const rep = await this.#reporter(r, userId, summary.reportingCurrency, today);
      const since = oneYearBefore(today);
      const movements = (await r.cashMovements.listByUser(userId, { to: today })).filter(
        (m) => m.date > since && (m.type === 'DEPOSIT' || m.type === 'WITHDRAWAL') && !isUnassignedImportDeposit(m),
      );
      const average = Decimal.sum(movements.map((m) => rep.atDate(m.amount, m.currency, m.date))).div(Decimal.fromInt(12), 4);
      return average.isNegative() ? Decimal.ZERO : average;
    });
    const assumptions = {
      years: query.years ?? SNOWBALL_DEFAULTS.years,
      monthlyContribution: query.monthlyContribution ?? defaultContribution,
      contributionGrowth: query.contributionGrowth ?? Decimal.parse(SNOWBALL_DEFAULTS.contributionGrowth),
      reinvestDividends: query.reinvestDividends ?? SNOWBALL_DEFAULTS.reinvestDividends,
      dividendGrowth: query.dividendGrowth ?? Decimal.parse(SNOWBALL_DEFAULTS.dividendGrowth),
      priceGrowth: query.priceGrowth ?? Decimal.parse(SNOWBALL_DEFAULTS.priceGrowth),
      startYield: summary.marketValue.isZero() ? Decimal.ZERO : summary.dividends.expectedAnnualNet.div(summary.marketValue, RATE_SCALE),
    };
    const result = simulateSnowball({
      startNetWorth: summary.netWorth,
      ...assumptions,
      startYear: Number(today.slice(0, 4)),
      monthlyGoal: summary.incomeGoal?.monthlyGoalReporting ?? null,
    });
    return {
      reportingCurrency: summary.reportingCurrency,
      assumptions,
      start: { netWorth: summary.netWorth, annualDividendsNet: summary.dividends.expectedAnnualNet },
      ...result,
    };
  }

  /** P2: meta convertida a TC actual y cobertura (12 meses cobrados y esperada). */
  #incomeGoal(goal: Money | null, rep: Reporter, netLast12Months: Decimal, expectedAnnualNet: Decimal): PortfolioSummary['incomeGoal'] {
    if (!goal) return null;
    const monthly = roundAmount(rep.atCurrent(goal.amount, goal.currency));
    const yearly = monthly.mul(Decimal.fromInt(12));
    return {
      goal,
      monthlyGoalReporting: monthly,
      coverageLast12Months: netLast12Months.div(yearly, RATE_SCALE),
      coverageExpected: expectedAnnualNet.div(yearly, RATE_SCALE),
    };
  }

  /** Dividendos por mes (incluye meses en 0) y por año con crecimiento, en moneda de reporte. */
  dividendsMonthly(userId: string, query: { reportingCurrency?: Currency | undefined; from?: string | undefined; to?: string | undefined }): Promise<DividendsMonthly> {
    const today = this.#clock.today();
    return this.#uow.read(async (r) => {
      const dividends = await r.dividends.listByUser(userId, {});
      const rep = await this.#reporter(r, userId, query.reportingCurrency, today);
      const current = today.slice(0, 7);
      const plus3 = new Date(Date.UTC(Number(current.slice(0, 4)), Number(current.slice(5)) - 1 + 3, 1)).toISOString().slice(0, 7);
      const from = query.from ?? dividends[0]?.paymentDate.slice(0, 7) ?? current;
      const to = query.to ?? plus3;
      if (from > to) throw new ValidationError([{ field: 'from', message: 'Debe ser ≤ to' }]);
      // Cada dividendo a TC de su fecha de pago (los futuros, al último disponible).
      const reported = dividends.map((d) => ({
        paymentDate: d.paymentDate,
        status: d.status,
        net: rep.atDate(d.netAmount, d.currency, d.paymentDate),
        gross: rep.atDate(d.grossAmount, d.currency, d.paymentDate),
        withholding: rep.atDate(d.withholdingAmount, d.currency, d.paymentDate),
      }));
      return { reportingCurrency: rep.currency, ...dividendsByMonth({ dividends: reported, from, to, today }) };
    });
  }

  /**
   * Serie del portafolio en moneda de reporte, calculada a partir de operaciones, caja, dividendos,
   * cierres y tipos de cambio (no se guarda: siempre refleja las ediciones).
   */
  history(userId: string, query: HistoryQuery): Promise<{ reportingCurrency: Currency; items: HistoryPoint[] }> {
    const to = query.to ?? this.#clock.today();
    return this.#uow.read(async (r) => {
      const trades = await r.trades.listByUser(userId);
      const from = query.from ?? trades[0]?.tradeDate ?? to;
      if (from > to) throw new ValidationError([{ field: 'from', message: 'Debe ser ≤ to' }]);
      const dates = sampleDates(from, to, query.interval);
      if (dates.length > MAX_HISTORY_POINTS) {
        throw new ValidationError([{ field: 'from', message: `La serie supera ${MAX_HISTORY_POINTS} puntos: acota el rango o usa week/month` }]);
      }
      const rep = await this.#reporter(r, userId, query.reportingCurrency, to);
      const ids = [...new Set(trades.map((t) => t.instrumentId))];
      const [instruments, movements, dividends, closes, quotes] = await Promise.all([
        r.instruments.findByIds(ids),
        r.cashMovements.listByUser(userId, { to }),
        r.dividends.listByUser(userId, { status: 'PAID', to }),
        r.prices.closesUpTo(ids, to),
        r.prices.quotes(ids),
      ]);
      const currency = new Map(instruments.map((i) => [i.id, i.currency]));
      const items = computePortfolioHistory({
        dates,
        trades,
        currencyOf: (id) => currency.get(id)!,
        movements,
        dividends,
        priceAt: (id, date) => resolvePrice(quotes.get(id), closeOnOrBefore(closes.get(id) ?? [], date), date)?.price ?? null,
        toReporting: (amount, c, date) => rep.atDate(amount, c, date),
      });
      return { reportingCurrency: rep.currency, items };
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
