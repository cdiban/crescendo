import type { CashMovement } from '../../domain/cash-movement.ts';
import type { Decimal } from '../../domain/decimal.ts';
import type { Market } from '../../domain/market.ts';
import type { PreferencesView } from '../../application/use-cases/preferences.ts';
import type { HistoryPoint } from '../../domain/portfolio-history.ts';
import type { AccountView } from '../../application/use-cases/accounts.ts';
import type { CashTransferView } from '../../application/use-cases/cash.ts';
import type { InstrumentView } from '../../application/use-cases/catalog.ts';
import type { DividendView } from '../../application/use-cases/dividends.ts';
import type {
  DividendSummary,
  DividendsMonthly,
  DividendsPerShare,
  DividendsYearOverYear,
  DividendCalendar,
  Allocation,
  SnowballProjection,
  PortfolioSummary,
  PositionsResult,
  PositionRow,
  ReportingAmounts,
} from '../../application/use-cases/portfolio.ts';
import type { TradeView } from '../../application/use-cases/trades.ts';

// DTOs del contrato: montos siempre como string decimal, nunca number.

const s = (d: Decimal) => d.toString();
const sn = (d: Decimal | null) => (d === null ? null : d.toString());

export const presentMarket = (m: Market) => ({
  code: m.code,
  name: m.name,
  country: m.country,
  currency: m.currency,
  timezone: m.timezone,
  defaultWithholdingRate: s(m.defaultWithholdingRate),
});

export const presentInstrument = (i: InstrumentView) => ({
  id: i.id,
  symbol: i.symbol,
  marketCode: i.marketCode,
  name: i.name,
  type: i.type,
  currency: i.currency,
  sector: i.sector,
  industry: i.industry,
  withholdingRate: sn(i.withholdingRate),
  effectiveWithholdingRate: s(i.effectiveWithholdingRate),
  annualDividendPerShare: sn(i.annualDividendPerShare),
  priceSymbol: i.priceSymbol,
  effectivePriceSymbol: i.effectivePriceSymbol,
  lastPrice: i.lastPrice
    ? {
        date: i.lastPrice.date,
        price: s(i.lastPrice.price),
        currency: i.lastPrice.currency,
        asOf: i.lastPrice.asOf.toISOString(),
        source: i.lastPrice.source,
        previousClose: sn(i.lastPrice.previousClose),
      }
    : null,
});

export const presentAccount = (a: AccountView) => ({
  id: a.id,
  name: a.name,
  broker: a.broker,
  baseCurrency: a.baseCurrency,
  archived: a.archived,
  cashBalances: a.cashBalances.map((b) => ({ amount: s(b.amount), currency: b.currency })),
});

export const presentTrade = (t: TradeView) => ({
  id: t.id,
  accountId: t.accountId,
  instrumentId: t.instrumentId,
  symbol: t.symbol,
  side: t.side,
  tradeDate: t.tradeDate,
  quantity: s(t.quantity),
  price: s(t.price),
  commission: s(t.commission),
  commissionTax: s(t.commissionTax),
  currency: t.currency,
  grossAmount: s(t.grossAmount),
  total: s(t.total),
  needsReview: t.needsReview,
  notes: t.notes,
});

export const presentDividend = (d: DividendView) => ({
  id: d.id,
  accountId: d.accountId,
  instrumentId: d.instrumentId,
  symbol: d.symbol,
  status: d.status,
  kind: d.kind,
  exDate: d.exDate,
  paymentDate: d.paymentDate,
  currency: d.currency,
  perShare: sn(d.perShare),
  quantity: sn(d.quantity),
  grossAmount: s(d.grossAmount),
  withholdingRate: s(d.withholdingRate),
  withholdingAmount: s(d.withholdingAmount),
  netAmount: s(d.netAmount),
  cashMovementId: d.cashMovementId,
  notes: d.notes,
});

export const presentCashMovement = (m: CashMovement) => ({
  id: m.id,
  accountId: m.accountId,
  date: m.date,
  type: m.type,
  amount: s(m.amount),
  currency: m.currency,
  description: m.description,
  source: m.source,
  importRole: m.importRole,
  tradeId: m.tradeId,
  dividendId: m.dividendId,
  transferId: m.transferId,
});

export const presentTransfer = (t: CashTransferView) => ({
  id: t.id,
  date: t.date,
  out: presentCashMovement(t.out),
  in: presentCashMovement(t.in),
  rate: s(t.rate),
});

export const presentReporting = (r: ReportingAmounts) => ({
  currency: r.currency,
  costBasis: s(r.costBasis),
  costBasisAtCurrentRate: s(r.costBasisAtCurrentRate),
  fxEffect: s(r.fxEffect),
  realizedGain: s(r.realizedGain),
  dividendsNet: s(r.dividendsNet),
  expectedAnnualIncomeGross: sn(r.expectedAnnualIncomeGross),
  marketValue: sn(r.marketValue),
  priceEffect: sn(r.priceEffect),
  unrealizedGain: sn(r.unrealizedGain),
});

export const presentPosition = (p: PositionRow) => ({
  accountId: p.accountId,
  instrumentId: p.instrumentId,
  symbol: p.symbol,
  name: p.name,
  marketCode: p.marketCode,
  type: p.type,
  sector: p.sector,
  currency: p.currency,
  quantity: s(p.quantity),
  averageCost: s(p.averageCost),
  costBasis: s(p.costBasis),
  realizedGain: s(p.realizedGain),
  dividendsGross: s(p.dividendsGross),
  dividendsNet: s(p.dividendsNet),
  annualDividendPerShare: sn(p.annualDividendPerShare),
  expectedAnnualIncomeGross: sn(p.expectedAnnualIncomeGross),
  yieldOnCost: sn(p.yieldOnCost),
  firstTradeDate: p.firstTradeDate,
  paymentMonths: p.paymentMonths,
  reporting: presentReporting(p.reporting),
  marketPrice: sn(p.marketPrice),
  priceAsOf: p.priceAsOf?.toISOString() ?? null,
  priceDate: p.priceDate,
  priceIsIntraday: p.priceIsIntraday,
  priceSource: p.priceSource,
  marketValue: sn(p.marketValue),
  unrealizedGain: sn(p.unrealizedGain),
  unrealizedReturn: sn(p.unrealizedReturn),
  totalReturn: sn(p.totalReturn),
  positionReturn: sn(p.positionReturn),
  portfolioWeight: sn(p.portfolioWeight),
  currentYield: sn(p.currentYield),
  dayChange: sn(p.dayChange),
});

export const presentPositions = (r: PositionsResult) => ({
  reportingCurrency: r.reportingCurrency,
  fxAsOf: r.fxAsOf,
  items: r.items.map(presentPosition),
  totalsByCurrency: r.totalsByCurrency.map((t) => ({
    currency: t.currency,
    costBasis: s(t.costBasis),
    realizedGain: s(t.realizedGain),
    dividendsGross: s(t.dividendsGross),
    dividendsNet: s(t.dividendsNet),
    expectedAnnualIncomeGross: s(t.expectedAnnualIncomeGross),
    marketValue: s(t.marketValue),
    unrealizedGain: s(t.unrealizedGain),
    pricedCoverage: s(t.pricedCoverage),
  })),
  total: presentReporting(r.total),
});

export const presentPortfolioSummary = (p: PortfolioSummary) => ({
  reportingCurrency: p.reportingCurrency,
  asOf: p.asOf,
  fxAsOf: p.fxAsOf,
  contributedCapital: s(p.contributedCapital),
  costBasis: s(p.costBasis),
  costBasisAtCurrentRate: s(p.costBasisAtCurrentRate),
  cash: s(p.cash),
  fxEffect: { positions: s(p.fxEffect.positions), cash: s(p.fxEffect.cash), total: s(p.fxEffect.total) },
  realizedGain: s(p.realizedGain),
  marketValue: s(p.marketValue),
  netWorth: s(p.netWorth),
  priceEffect: s(p.priceEffect),
  unrealizedGain: s(p.unrealizedGain),
  totalGain: s(p.totalGain),
  pricedCoverage: s(p.pricedCoverage),
  pricesAsOf: p.pricesAsOf?.toISOString() ?? null,
  pricesDate: p.pricesDate,
  dividendAlerts: p.dividendAlerts,
  incomeGoal: p.incomeGoal
    ? {
        goal: { amount: s(p.incomeGoal.goal.amount), currency: p.incomeGoal.goal.currency },
        monthlyGoalReporting: s(p.incomeGoal.monthlyGoalReporting),
        coverageLast12Months: s(p.incomeGoal.coverageLast12Months),
        coverageExpected: s(p.incomeGoal.coverageExpected),
      }
    : null,
  dividends: {
    netYearToDate: s(p.dividends.netYearToDate),
    netLast12Months: s(p.dividends.netLast12Months),
    netTotal: s(p.dividends.netTotal),
    expectedAnnualGross: s(p.dividends.expectedAnnualGross),
    currentYield: sn(p.dividends.currentYield),
    expectedAnnualNet: s(p.dividends.expectedAnnualNet),
  },
  exposure: p.exposure.map((e) => ({ currency: e.currency, amount: s(e.amount), weight: s(e.weight) })),
});

export const presentSummary = (summary: DividendSummary) => ({
  year: summary.year,
  reporting: {
    currency: summary.reporting.currency,
    monthlyGross: summary.reporting.monthlyGross.map(s),
    monthlyNet: summary.reporting.monthlyNet.map(s),
    totalGross: s(summary.reporting.totalGross),
    totalNet: s(summary.reporting.totalNet),
  },
  groups: summary.groups.map((g) => ({
    currency: g.currency,
    rows: g.rows.map((r) => ({
      instrumentId: r.instrumentId,
      symbol: r.symbol,
      monthlyGross: r.monthlyGross.map(s),
      monthlyNet: r.monthlyNet.map(s),
      totalGross: s(r.totalGross),
      totalNet: s(r.totalNet),
    })),
    monthlyGross: g.monthlyGross.map(s),
    monthlyNet: g.monthlyNet.map(s),
    totalGross: s(g.totalGross),
    totalNet: s(g.totalNet),
  })),
});

export const presentPage = <T, U>(page: { items: T[]; total: number }, present: (item: T) => U) => ({
  items: page.items.map(present),
  total: page.total,
});

export const presentHistoryPoint = (p: HistoryPoint) => ({
  date: p.date,
  marketValue: s(p.marketValue),
  costBasis: s(p.costBasis),
  cash: s(p.cash),
  contributedCapital: s(p.contributedCapital),
  dividendsNetCumulative: s(p.dividendsNetCumulative),
  realizedGainCumulative: s(p.realizedGainCumulative),
  unpricedAtCost: s(p.unpricedAtCost),
  netWorth: s(p.netWorth),
  totalGain: s(p.totalGain),
});

export const presentPreferences = (p: PreferencesView) => ({
  reportingCurrency: p.reportingCurrency,
  monthlyIncomeGoal: p.monthlyIncomeGoal ? { amount: s(p.monthlyIncomeGoal.amount), currency: p.monthlyIncomeGoal.currency } : null,
  dividendCutThreshold: s(p.dividendCutThreshold),
});

export const presentDividendsMonthly = (m: DividendsMonthly) => ({
  reportingCurrency: m.reportingCurrency,
  months: m.months.map((x) => ({
    month: x.month,
    paidNet: s(x.paidNet),
    paidGross: s(x.paidGross),
    announcedNet: s(x.announcedNet),
    cumulativePaidNet: s(x.cumulativePaidNet),
  })),
  years: m.years.map((y) => ({ year: y.year, paidNet: s(y.paidNet), paidGross: s(y.paidGross), withholding: s(y.withholding), growth: sn(y.growth) })),
});

export const presentCalendar = (c: DividendCalendar) => ({
  reportingCurrency: c.reportingCurrency,
  totalNet: s(c.totalNet),
  months: c.months.map((m) => ({
    month: m.month,
    totalNet: s(m.totalNet),
    announcedNet: s(m.announcedNet),
    estimatedNet: s(m.estimatedNet),
    items: m.items.map((i) => ({
      instrumentId: i.instrumentId,
      symbol: i.symbol,
      status: i.status,
      date: i.date,
      currency: i.currency,
      netAmount: s(i.netAmount),
      netAmountReporting: s(i.netAmountReporting),
    })),
  })),
});

export const presentAllocation = (a: Allocation) => ({
  by: a.by,
  reportingCurrency: a.reportingCurrency,
  total: s(a.total),
  items: a.items.map((i) => ({
    key: i.key,
    label: i.label,
    value: s(i.value),
    weight: s(i.weight),
    expectedAnnualIncomeGross: s(i.expectedAnnualIncomeGross),
    incomeWeight: s(i.incomeWeight),
    valuedAtCost: s(i.valuedAtCost),
  })),
});

export const presentSnowball = (p: SnowballProjection) => ({
  reportingCurrency: p.reportingCurrency,
  assumptions: {
    years: p.assumptions.years,
    monthlyContribution: s(p.assumptions.monthlyContribution),
    contributionGrowth: s(p.assumptions.contributionGrowth),
    reinvestDividends: p.assumptions.reinvestDividends,
    dividendGrowth: s(p.assumptions.dividendGrowth),
    priceGrowth: s(p.assumptions.priceGrowth),
    startYield: s(p.assumptions.startYield),
  },
  start: { netWorth: s(p.start.netWorth), annualDividendsNet: s(p.start.annualDividendsNet) },
  years: p.years.map((y) => ({
    year: y.year,
    calendarYear: y.calendarYear,
    contributedCumulative: s(y.contributedCumulative),
    netWorth: s(y.netWorth),
    annualDividendsNet: s(y.annualDividendsNet),
    monthlyDividendsNet: s(y.monthlyDividendsNet),
    dividendsCumulative: s(y.dividendsCumulative),
    goalCoverage: sn(y.goalCoverage),
  })),
  goalReachedYear: p.goalReachedYear,
});

const payment = (p: { paymentDate: string; perShare: Decimal; estimated: boolean } | null) =>
  p ? { paymentDate: p.paymentDate, perShare: s(p.perShare), estimated: p.estimated } : null;

export const presentPerShare = (x: DividendsPerShare) => ({
  asOf: x.asOf,
  cutThreshold: s(x.cutThreshold),
  items: x.items.map((r) => ({
    instrumentId: r.instrumentId,
    symbol: r.symbol,
    name: r.name,
    currency: r.currency,
    firstTradeDate: r.firstTradeDate,
    years: r.years.map((y) => ({ year: y.year, perShare: s(y.perShare), growth: sn(y.growth), partial: y.partial })),
    ttmPerShare: s(r.ttmPerShare),
    previousTtmPerShare: s(r.previousTtmPerShare),
    ttmGrowth: sn(r.ttmGrowth),
    cagr: sn(r.cagr),
    lastRegular: payment(r.lastRegular),
    previousRegular: payment(r.previousRegular),
    status: r.status,
    cutReason: r.cutReason,
    dataQuality: r.dataQuality,
  })),
});

export const presentYearOverYear = (x: DividendsYearOverYear) => ({
  amountCurrency: x.amountCurrency,
  converted: x.converted,
  availableYears: x.availableYears,
  years: x.years.map((y) => ({
    year: y.year,
    totalPaidNet: s(y.totalPaidNet),
    totalAnnouncedNet: s(y.totalAnnouncedNet),
    growth: sn(y.growth),
    months: y.months.map((m) => ({
      month: m.month,
      paidNet: s(m.paidNet),
      announcedNet: s(m.announcedNet),
      ytdPaidNet: sn(m.ytdPaidNet),
      growthVsPreviousYear: sn(m.growthVsPreviousYear),
    })),
  })),
});
