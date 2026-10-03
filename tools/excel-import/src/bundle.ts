// Formato ImportBundle v1 (docs/fase-1.md §3). Todos los números como string decimal.

export type BundleAccount = { key: string; name: string; broker: string; baseCurrency: 'CLP' | 'USD' | 'EUR' };

export type BundleInstrument = {
  symbol: string;
  marketCode: 'XSGO' | 'US';
  name: string;
  type: 'STOCK' | 'ETF' | 'FUND' | 'REIT';
  sector: string | null;
  industry: string | null;
  annualDividendPerShare: string | null;
};

export type BundleTrade = {
  accountKey: string;
  symbol: string;
  marketCode: 'XSGO' | 'US';
  side: 'BUY' | 'SELL';
  tradeDate: string;
  quantity: string;
  price: string;
  commission: string;
  commissionTax: string;
  needsReview: boolean;
  notes: string | null;
};

export type BundleDividend = {
  accountKey: string;
  symbol: string;
  marketCode: 'XSGO' | 'US';
  status: 'ANNOUNCED' | 'PAID';
  kind: 'REGULAR' | 'PROVISIONAL' | 'FINAL' | 'ADDITIONAL' | 'SPECIAL' | 'OTHER';
  paymentDate: string;
  grossAmount: string;
  withholdingRate: string;
  /** Neto efectivamente recibido (EE.UU.): se conserva y se ajusta la retención. */
  netAmount?: string;
};

export type BundleCashMovement = {
  accountKey: string;
  date: string;
  type: 'DEPOSIT' | 'ADJUSTMENT';
  amount: string;
  currency: 'CLP' | 'USD' | 'EUR';
  description: string;
  /** (v0.6) Marca del movimiento; la plataforma la usa en vez del texto de la descripción. */
  importRole: 'INFERRED_CONTRIBUTION' | 'UNASSIGNED_DEPOSIT' | 'RESIDUAL_ADJUSTMENT';
};

export type ImportBundle = {
  version: 1;
  cutoffDate: string;
  accounts: BundleAccount[];
  instruments: BundleInstrument[];
  trades: BundleTrade[];
  dividends: BundleDividend[];
  cashMovements: BundleCashMovement[];
};
