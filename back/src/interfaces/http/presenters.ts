import type { CashMovement } from '../../domain/cash-movement.ts';
import type { Decimal } from '../../domain/decimal.ts';
import type { Market } from '../../domain/market.ts';
import type { HistoryPoint } from '../../domain/portfolio-history.ts';
import type { AccountView } from '../../application/use-cases/accounts.ts';
import type { CashTransferView } from '../../application/use-cases/cash.ts';
import type { InstrumentView } from '../../application/use-cases/catalog.ts';
import type { DividendView } from '../../application/use-cases/dividends.ts';
import type {
  DividendSummary,
  PortfolioSummary,
  PositionsResult,
  PositionView,
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

export const presentPosition = (p: PositionView) => ({
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
  priceSource: p.priceSource,
  marketValue: sn(p.marketValue),
  unrealizedGain: sn(p.unrealizedGain),
  unrealizedReturn: sn(p.unrealizedReturn),
  totalReturn: sn(p.totalReturn),
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
  dividends: {
    netYearToDate: s(p.dividends.netYearToDate),
    netLast12Months: s(p.dividends.netLast12Months),
    netTotal: s(p.dividends.netTotal),
    expectedAnnualGross: s(p.dividends.expectedAnnualGross),
    currentYield: sn(p.dividends.currentYield),
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
});
