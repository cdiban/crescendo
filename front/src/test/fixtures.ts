import type { Account, CashMovement, Dividend, DividendSummary, FxRate, Instrument, Market, PortfolioSummary, Position, PositionList, Trade } from '../api/client.ts';

export const ITAU = 'a0000000-0000-4000-8000-000000000001';
export const IB = 'a0000000-0000-4000-8000-000000000002';
export const ZESTY = 'a0000000-0000-4000-8000-000000000003';
export const PEHUENCHE = 'i0000000-0000-4000-8000-000000000001';
export const KO = 'i0000000-0000-4000-8000-000000000002';
export const BITO = 'i0000000-0000-4000-8000-000000000003';

export const markets: Market[] = [
  { code: 'XSGO', name: 'Bolsa de Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', defaultWithholdingRate: '0' },
  { code: 'US', name: 'EE.UU.', country: 'US', currency: 'USD', timezone: 'America/New_York', defaultWithholdingRate: '0.15' },
];

export const accounts: Account[] = [
  { id: IB, name: 'Interactive Brokers', broker: 'IBKR', baseCurrency: 'USD', archived: false, cashBalances: [{ amount: '1302.86', currency: 'USD' }, { amount: '0', currency: 'CLP' }] },
  { id: ITAU, name: 'Itaú', broker: 'Itaú', baseCurrency: 'CLP', archived: false, cashBalances: [{ amount: '1984144', currency: 'CLP' }] },
  { id: ZESTY, name: 'Zesty', broker: 'Zesty', baseCurrency: 'USD', archived: true, cashBalances: [{ amount: '24.01', currency: 'USD' }] },
];

const instrument = (over: Partial<Instrument>): Instrument => ({
  id: PEHUENCHE, symbol: 'PEHUENCHE', marketCode: 'XSGO', name: 'Pehuenche', type: 'STOCK', currency: 'CLP',
  sector: 'Energy', industry: 'Electric', withholdingRate: null, effectiveWithholdingRate: '0', annualDividendPerShare: '266',
  priceSymbol: null, effectivePriceSymbol: 'PEHUENCHE.SN',
  lastPrice: { price: '2701', currency: 'CLP', asOf: '2026-10-03T19:00:00Z', source: 'PROVIDER', previousClose: '2690' },
  ...over,
});

export const instruments: Instrument[] = [
  instrument({}),
  instrument({ id: KO, symbol: 'KO', marketCode: 'US', name: 'Coca-Cola', currency: 'USD', sector: 'Consumer', industry: 'Beverages', effectiveWithholdingRate: '0.15', annualDividendPerShare: '2.04',
    effectivePriceSymbol: 'KO', lastPrice: { price: '68.2', currency: 'USD', asOf: '2026-10-03T19:59:00Z', source: 'PROVIDER', previousClose: '68.5' } }),
  instrument({ id: BITO, symbol: 'BITO', marketCode: 'US', name: 'BITO', type: 'ETF', currency: 'USD', sector: null, industry: null, withholdingRate: '0.3', effectiveWithholdingRate: '0.3', annualDividendPerShare: null,
    priceSymbol: 'BITO-X', effectivePriceSymbol: 'BITO-X', lastPrice: null }),
];

const position = (over: Partial<Position>): Position => ({
  accountId: null, instrumentId: PEHUENCHE, symbol: 'PEHUENCHE', name: 'Pehuenche', marketCode: 'XSGO', type: 'STOCK', sector: 'Energy',
  currency: 'CLP', quantity: '115', averageCost: '2607.8', costBasis: '299897', realizedGain: '0', dividendsGross: '93178',
  dividendsNet: '93178', annualDividendPerShare: '266', expectedAnnualIncomeGross: '30590', yieldOnCost: '0.102', firstTradeDate: '2025-07-31',
  paymentMonths: [5, 12],
  marketPrice: '2701', priceAsOf: '2026-10-03T19:00:00Z', priceSource: 'PROVIDER', marketValue: '310615', unrealizedGain: '10718',
  unrealizedReturn: '0.0357', totalReturn: '0.3465', currentYield: '0.0985', dayChange: '0.004089',
  reporting: {
    currency: 'USD', costBasis: '318.1234', costBasisAtCurrentRate: '305.5', fxEffect: '-12.6234', realizedGain: '0', dividendsNet: '98.7',
    expectedAnnualIncomeGross: '32.43', marketValue: '316.4', priceEffect: '10.9', unrealizedGain: '-1.7234',
  },
  ...over,
});
const usdReporting = (costBasis: string, dividendsNet: string, expected: string | null, marketValue: string | null, unrealized: string | null) => ({
  currency: 'USD' as const, costBasis, costBasisAtCurrentRate: costBasis, fxEffect: '0', realizedGain: '0', dividendsNet, expectedAnnualIncomeGross: expected,
  marketValue, priceEffect: unrealized, unrealizedGain: unrealized,
});
const noMarket = { marketPrice: null, priceAsOf: null, priceSource: null, marketValue: null, unrealizedGain: null, unrealizedReturn: null, totalReturn: null, currentYield: null, dayChange: null };

export const positionsByInstrument: Position[] = [
  position({}),
  position({ instrumentId: KO, symbol: 'KO', name: 'Coca-Cola', marketCode: 'US', currency: 'USD', sector: 'Consumer', quantity: '10.5', averageCost: '60.1234', costBasis: '631.2957', dividendsGross: '20.4', dividendsNet: '17.34', annualDividendPerShare: '2.04', expectedAnnualIncomeGross: '21.42', yieldOnCost: '0.0339', paymentMonths: [4, 7, 10, 12],
    marketPrice: '68.2', priceAsOf: '2026-10-03T19:59:00Z', priceSource: 'PROVIDER', marketValue: '716.1', unrealizedGain: '84.8043',
    unrealizedReturn: '0.1343', totalReturn: '0.161', currentYield: '0.0299', dayChange: '-0.00438',
    reporting: usdReporting('631.2957', '17.34', '21.42', '716.1', '84.8043') }),
  position({ instrumentId: BITO, symbol: 'BITO', name: 'BITO', marketCode: 'US', type: 'ETF', currency: 'USD', sector: null, quantity: '3', averageCost: '20', costBasis: '60', dividendsGross: '0', dividendsNet: '0', annualDividendPerShare: null, expectedAnnualIncomeGross: null, yieldOnCost: null, paymentMonths: [], ...noMarket, reporting: usdReporting('60', '0', null, null, null) }),
];

/** Respuesta de GET /positions (groupBy=instrument, reporte USD). */
export const positionList = (items: Position[] = positionsByInstrument): PositionList => ({
  reportingCurrency: 'USD',
  fxAsOf: '2026-10-02',
  items,
  totalsByCurrency: [
    { currency: 'CLP', costBasis: '299897', realizedGain: '193810.64', dividendsGross: '93178', dividendsNet: '93178', expectedAnnualIncomeGross: '30590', marketValue: '310615', unrealizedGain: '10718', pricedCoverage: '1' },
    { currency: 'USD', costBasis: '691.2957', realizedGain: '-1.33', dividendsGross: '20.4', dividendsNet: '17.34', expectedAnnualIncomeGross: '21.42', marketValue: '716.1', unrealizedGain: '84.8043', pricedCoverage: '0.9132' },
  ],
  total: {
    currency: 'USD', costBasis: '1009.4191', costBasisAtCurrentRate: '996.7957', fxEffect: '-12.6234', realizedGain: '202.15', dividendsNet: '116.04',
    expectedAnnualIncomeGross: '53.85', marketValue: '1032.5', priceEffect: '95.7043', unrealizedGain: '83.0809',
  },
});

export const positionsByAccount: Position[] = [
  { ...positionsByInstrument[0]!, accountId: ITAU },
  { ...positionsByInstrument[1]!, accountId: IB },
  { ...positionsByInstrument[2]!, accountId: ZESTY },
];

export const dividend = (over: Partial<Dividend> = {}): Dividend => ({
  id: 'd0000000-0000-4000-8000-000000000001', accountId: IB, instrumentId: KO, symbol: 'KO', status: 'ANNOUNCED', kind: 'REGULAR',
  exDate: null, paymentDate: '2026-12-15', currency: 'USD', perShare: '0.51', quantity: '10.5', grossAmount: '5.355',
  withholdingRate: '0.15', withholdingAmount: '0.80', netAmount: '4.555', cashMovementId: null, notes: null, ...over,
});

const months = (values: Record<number, string>) => Array.from({ length: 12 }, (_, i) => values[i] ?? '0');

export const summary2026: DividendSummary = {
  year: 2026,
  reporting: { currency: 'USD', monthlyGross: months({ 3: '5.1', 4: '98.71', 6: '5.1' }), monthlyNet: months({ 3: '4.34', 4: '98.71', 6: '4.34' }), totalGross: '108.91', totalNet: '107.39' },
  groups: [
    {
      currency: 'CLP',
      rows: [{ instrumentId: PEHUENCHE, symbol: 'PEHUENCHE', monthlyGross: months({ 4: '93178' }), monthlyNet: months({ 4: '93178' }), totalGross: '93178', totalNet: '93178' }],
      monthlyGross: months({ 4: '93178' }), monthlyNet: months({ 4: '93178' }), totalGross: '93178', totalNet: '93178',
    },
    {
      currency: 'USD',
      rows: [{ instrumentId: KO, symbol: 'KO', monthlyGross: months({ 3: '5.1', 6: '5.1' }), monthlyNet: months({ 3: '4.34', 6: '4.34' }), totalGross: '10.2', totalNet: '8.68' }],
      monthlyGross: months({ 3: '5.1', 6: '5.1' }), monthlyNet: months({ 3: '4.34', 6: '4.34' }), totalGross: '10.2', totalNet: '8.68',
    },
  ],
};

export const trade = (over: Partial<Trade> = {}): Trade => ({
  id: 't0000000-0000-4000-8000-000000000001', accountId: ITAU, instrumentId: PEHUENCHE, symbol: 'PEHUENCHE', side: 'BUY', tradeDate: '2025-07-31',
  quantity: '115', price: '2600.1', commission: '748', commissionTax: '142.12', currency: 'CLP', grossAmount: '299011.5', total: '299901.62',
  needsReview: false, notes: null, ...over,
});

export const movement = (over: Partial<CashMovement> = {}): CashMovement => ({
  id: 'm0000000-0000-4000-8000-000000000001', accountId: ITAU, date: '2025-01-20', type: 'DEPOSIT', amount: '1000000', currency: 'CLP',
  description: 'Aporte', source: 'MANUAL', tradeId: null, dividendId: null, transferId: null, ...over,
});

export const page = <T,>(items: T[], total = items.length) => ({ items, total });

export const portfolioSummary = (over: Partial<PortfolioSummary> = {}): PortfolioSummary => ({
  reportingCurrency: 'USD',
  asOf: '2026-10-03',
  fxAsOf: '2026-10-02',
  contributedCapital: '61234.5678',
  costBasis: '62000.12',
  costBasisAtCurrentRate: '60500.5',
  cash: '3434.1',
  fxEffect: { positions: '-1499.62', cash: '25.3', total: '-1474.32' },
  realizedGain: '204.1',
  dividends: { netYearToDate: '2100.55', netLast12Months: '2600', netTotal: '4300.2', expectedAnnualGross: '3100.4', currentYield: '0.0484' },
  marketValue: '64000.5',
  netWorth: '67434.6',
  priceEffect: '3500.38',
  unrealizedGain: '2000.76',
  totalGain: '6200.03',
  pricedCoverage: '1',
  pricesAsOf: '2026-10-03T15:20:00Z',
  exposure: [
    { currency: 'CLP', amount: '27500.3', weight: '0.4302' },
    { currency: 'USD', amount: '36434.3', weight: '0.5698' },
  ],
  ...over,
});

export const latestFx: FxRate[] = [
  { base: 'USD', quote: 'CLP', date: '2026-10-02', rate: '943.52', source: 'mindicador:dolar' },
  { base: 'EUR', quote: 'CLP', date: '2026-10-02', rate: '1021.7', source: 'mindicador:euro' },
  { base: 'EUR', quote: 'USD', date: '2026-10-02', rate: '1.0828814', source: 'derived:CLP' },
  { base: 'CLF', quote: 'CLP', date: '2026-10-03', rate: '39485.65', source: 'mindicador:uf' },
];
