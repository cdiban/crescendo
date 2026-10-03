import type { Account, CashMovement, Dividend, DividendSummary, Instrument, Market, Position, Trade } from '../api/client.ts';

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
  sector: 'Energy', industry: 'Electric', withholdingRate: null, effectiveWithholdingRate: '0', annualDividendPerShare: '266', ...over,
});

export const instruments: Instrument[] = [
  instrument({}),
  instrument({ id: KO, symbol: 'KO', marketCode: 'US', name: 'Coca-Cola', currency: 'USD', sector: 'Consumer', industry: 'Beverages', effectiveWithholdingRate: '0.15', annualDividendPerShare: '2.04' }),
  instrument({ id: BITO, symbol: 'BITO', marketCode: 'US', name: 'BITO', type: 'ETF', currency: 'USD', sector: null, industry: null, withholdingRate: '0.3', effectiveWithholdingRate: '0.3', annualDividendPerShare: null }),
];

const position = (over: Partial<Position>): Position => ({
  accountId: null, instrumentId: PEHUENCHE, symbol: 'PEHUENCHE', name: 'Pehuenche', marketCode: 'XSGO', type: 'STOCK', sector: 'Energy',
  currency: 'CLP', quantity: '115', averageCost: '2607.8', costBasis: '299897', realizedGain: '0', dividendsGross: '93178',
  dividendsNet: '93178', annualDividendPerShare: '266', expectedAnnualIncomeGross: '30590', yieldOnCost: '0.102', firstTradeDate: '2025-07-31',
  paymentMonths: [5, 12], ...over,
});

export const positionsByInstrument: Position[] = [
  position({}),
  position({ instrumentId: KO, symbol: 'KO', name: 'Coca-Cola', marketCode: 'US', currency: 'USD', sector: 'Consumer', quantity: '10.5', averageCost: '60.1234', costBasis: '631.2957', dividendsGross: '20.4', dividendsNet: '17.34', annualDividendPerShare: '2.04', expectedAnnualIncomeGross: '21.42', yieldOnCost: '0.0339', paymentMonths: [4, 7, 10, 12] }),
  position({ instrumentId: BITO, symbol: 'BITO', name: 'BITO', marketCode: 'US', type: 'ETF', currency: 'USD', sector: null, quantity: '3', averageCost: '20', costBasis: '60', dividendsGross: '0', dividendsNet: '0', annualDividendPerShare: null, expectedAnnualIncomeGross: null, yieldOnCost: null, paymentMonths: [] }),
];

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
