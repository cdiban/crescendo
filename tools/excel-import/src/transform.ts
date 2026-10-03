import { Decimal } from '../../../back/src/domain/decimal.ts';
import { computeDividendAmounts } from '../../../back/src/domain/dividend.ts';
import { computeHoldings, type PositionTrade } from '../../../back/src/domain/positions.ts';
import { tradeAmounts } from '../../../back/src/domain/trade.ts';
import type { BundleAccount, BundleDividend, BundleInstrument, BundleTrade, ImportBundle } from './bundle.ts';
import { inferCashMovements, type CashFlow } from './cash.ts';
import type { RawWorkbook } from './raw.ts';

// Reglas de limpieza y mapeo de docs/fase-1.md §3 (decisiones del usuario incluidas).

export const ACCOUNTS: BundleAccount[] = [
  { key: 'itau', name: 'Itaú Corredores', broker: 'Itaú', baseCurrency: 'CLP' },
  { key: 'ib', name: 'Interactive Brokers', broker: 'Interactive Brokers', baseCurrency: 'USD' },
  { key: 'zesty', name: 'Zesty', broker: 'Zesty', baseCurrency: 'USD' },
];

const SYMBOL_FIXES: Record<string, string> = { MKR: 'MRK' };
const TYPES: Record<string, BundleInstrument['type']> = {
  BITO: 'ETF', JEPQ: 'ETF', HDV: 'ETF', DGRO: 'ETF',
  CFINRENTAS: 'FUND', CFMITNIPSA: 'FUND', CFMDIVO: 'FUND',
  O: 'REIT',
};
const SECTOR_FIXES: Record<string, [string, string]> = {
  MCD: ['Consumer', 'Restaurants'],
  MSFT: ['Technology', 'Software'],
};
const CL_KINDS: Record<string, BundleDividend['kind']> = { Provisorio: 'PROVISIONAL', Definitivo: 'FINAL', Adicional: 'ADDITIONAL' };
const US_WITHHOLDING = Decimal.parse('0.15');
const REVIEW_NOTE = 'Venta importada al costo con fecha aproximada; revisar';

/** Ventas que el usuario confirma pero no están en el Excel: se importan al costo. */
export const MISSING_SALES = [
  { symbol: 'CFMDIVO', market: 'CL' as const, date: '2025-12-01', expectedQuantity: Decimal.parse('395') },
  { symbol: 'DGRO', market: 'US' as const, date: '2025-04-17', expectedQuantity: Decimal.parse('4') },
];

export type Anomaly = { kind: string; detail: string };

const marketCode = (market: 'CL' | 'US'): 'XSGO' | 'US' => (market === 'CL' ? 'XSGO' : 'US');
const fixSymbol = (symbol: string) => SYMBOL_FIXES[symbol] ?? symbol;
const accountFor = (market: 'CL' | 'US', symbol: string) => (market === 'CL' ? 'itau' : symbol === 'BITO' ? 'zesty' : 'ib');
const currencyOf = (accountKey: string) => ACCOUNTS.find((a) => a.key === accountKey)!.baseCurrency;

function asPositionTrade(t: BundleTrade): PositionTrade {
  return {
    accountId: t.accountKey,
    instrumentId: `${t.marketCode}:${t.symbol}`,
    side: t.side,
    tradeDate: t.tradeDate,
    quantity: Decimal.parse(t.quantity),
    price: Decimal.parse(t.price),
    commission: Decimal.parse(t.commission),
    commissionTax: Decimal.parse(t.commissionTax),
  };
}

function buildTrades(raw: RawWorkbook, anomalies: Anomaly[]): BundleTrade[] {
  const trades: BundleTrade[] = raw.trades.map((t) => {
    const symbol = fixSymbol(t.symbol);
    return {
      accountKey: accountFor(t.market, symbol),
      symbol,
      marketCode: marketCode(t.market),
      side: t.side,
      tradeDate: t.date,
      quantity: t.quantity.toString(),
      price: t.price.toString(),
      commission: t.commission.toString(),
      // CL: el Excel guarda la tasa de IVA; el monto es comisión × tasa.
      commissionTax: (t.market === 'CL' ? t.commission.mul(t.tax) : t.tax).round(4).toString(),
      needsReview: false,
      notes: null,
    };
  });

  for (const sale of MISSING_SALES) {
    const accountKey = accountFor(sale.market, sale.symbol);
    const instrumentId = `${marketCode(sale.market)}:${sale.symbol}`;
    const holding = computeHoldings(trades.map(asPositionTrade), sale.date).find(
      (h) => h.accountId === accountKey && h.instrumentId === instrumentId,
    );
    if (!holding || !holding.quantity.eq(sale.expectedQuantity)) {
      throw new Error(`${sale.symbol}: se esperaba una posición de ${sale.expectedQuantity} al ${sale.date} y hay ${holding?.quantity ?? 0}`);
    }
    trades.push({
      accountKey,
      symbol: sale.symbol,
      marketCode: marketCode(sale.market),
      side: 'SELL',
      tradeDate: sale.date,
      quantity: holding.quantity.toString(),
      price: holding.averageCost.toString(),
      commission: '0',
      commissionTax: '0',
      needsReview: true,
      notes: REVIEW_NOTE,
    });
    anomalies.push({
      kind: 'Venta al costo agregada',
      detail: `${sale.symbol}: ${holding.quantity} a ${holding.averageCost} (costo promedio con comisiones) el ${sale.date}, needsReview`,
    });
  }
  return trades;
}

function buildDividends(raw: RawWorkbook, cutoffDate: string, anomalies: Anomaly[]): BundleDividend[] {
  const seen = new Map<string, number>();
  for (const d of raw.dividends) {
    const key = `${fixSymbol(d.symbol)} ${d.date}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, n] of seen) if (n > 1) anomalies.push({ kind: 'Posible duplicado (se importan todos)', detail: `${key} ×${n}` });

  const dividends: BundleDividend[] = [];
  for (const d of raw.dividends) {
    const symbol = fixSymbol(d.symbol);
    if (d.amount.isZero()) {
      anomalies.push({ kind: 'Dividendo omitido (monto 0)', detail: `${symbol} ${d.date} (fila ${d.row})` });
      continue;
    }
    const market = d.country === 'CHILE' ? 'CL' : 'US';
    const common = {
      accountKey: accountFor(market, symbol),
      symbol,
      marketCode: marketCode(market),
      status: d.date > cutoffDate ? ('ANNOUNCED' as const) : ('PAID' as const),
      paymentDate: d.date,
    };
    if (market === 'CL') {
      dividends.push({ ...common, kind: (d.type && CL_KINDS[d.type]) || 'OTHER', grossAmount: d.amount.round(4).toString(), withholdingRate: '0' });
    } else {
      // El Monto de EE.UU. es lo que llegó (neto): se conserva y el bruto se reconstruye al 15 %.
      dividends.push({
        ...common,
        kind: 'REGULAR',
        grossAmount: d.amount.div(Decimal.ONE.sub(US_WITHHOLDING), 4).toString(),
        withholdingRate: US_WITHHOLDING.toString(),
        netAmount: d.amount.toString(),
      });
    }
  }
  return dividends;
}

function buildInstruments(raw: RawWorkbook, trades: BundleTrade[], dividends: BundleDividend[]): BundleInstrument[] {
  const keys = new Map<string, BundleInstrument['marketCode']>();
  for (const x of [...trades, ...dividends]) keys.set(x.symbol, x.marketCode);
  return [...keys.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([symbol, market]) => {
      const holding = raw.holdings.find((h) => fixSymbol(h.symbol) === symbol && marketCode(h.market) === market);
      const [sector, industry] = SECTOR_FIXES[symbol] ?? [holding?.sector ?? null, holding?.industry ?? null];
      return {
        symbol,
        marketCode: market,
        name: symbol,
        type: TYPES[symbol] ?? 'STOCK',
        sector,
        industry,
        annualDividendPerShare: holding?.theoreticalDividend?.toString() ?? null,
      };
    });
}

export function buildBundle(raw: RawWorkbook, cutoffDate: string): { bundle: ImportBundle; anomalies: Anomaly[] } {
  const anomalies: Anomaly[] = [];
  const trades = buildTrades(raw, anomalies);
  const dividends = buildDividends(raw, cutoffDate, anomalies);

  const flows: CashFlow[] = [
    ...trades.map((t) => ({
      accountKey: t.accountKey,
      currency: currencyOf(t.accountKey),
      date: t.tradeDate,
      amount: tradeAmounts(asPositionTrade(t)).cashAmount,
    })),
    ...dividends
      .filter((d) => d.status === 'PAID')
      .map((d) => ({ accountKey: d.accountKey, currency: currencyOf(d.accountKey), date: d.paymentDate, amount: dividendNet(d) })),
  ];
  const cashMovements = inferCashMovements({
    flows,
    targets: [
      { accountKey: 'itau', currency: 'CLP', amount: raw.cash.itau },
      { accountKey: 'ib', currency: 'USD', amount: raw.cash.ib },
      { accountKey: 'zesty', currency: 'USD', amount: raw.cash.zesty },
    ],
    cutoffDate,
  });

  const sortedTrades = [...trades].sort((a, b) =>
    a.tradeDate !== b.tradeDate ? (a.tradeDate < b.tradeDate ? -1 : 1) : a.side === b.side ? 0 : a.side === 'BUY' ? -1 : 1,
  );
  return {
    bundle: {
      version: 1,
      cutoffDate,
      accounts: ACCOUNTS,
      instruments: buildInstruments(raw, trades, dividends),
      trades: sortedTrades,
      dividends: [...dividends].sort((a, b) => (a.paymentDate < b.paymentDate ? -1 : a.paymentDate > b.paymentDate ? 1 : 0)),
      cashMovements,
    },
    anomalies,
  };
}

/** Neto con las mismas reglas de dominio que aplicará la plataforma. */
export function dividendNet(d: BundleDividend): Decimal {
  return computeDividendAmounts({
    currency: currencyOf(d.accountKey),
    grossAmount: Decimal.parse(d.grossAmount),
    withholdingRate: Decimal.parse(d.withholdingRate),
    netAmount: d.netAmount === undefined ? undefined : Decimal.parse(d.netAmount),
  }).netAmount;
}

export { asPositionTrade };
