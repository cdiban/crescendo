import { EntitySchema } from 'typeorm';

// Registros de persistencia: reflejan las tablas. El dominio nunca los ve;
// los repositorios traducen entre registro y entidad.

export type UserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
};

export type SessionRecord = {
  tokenHash: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
};

export const UserSchema = new EntitySchema<UserRecord>({
  name: 'User',
  tableName: 'users',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    email: { type: 'text', unique: true },
    passwordHash: { type: 'text', name: 'password_hash' },
    createdAt: { type: 'timestamptz', name: 'created_at' },
  },
});

export const SessionSchema = new EntitySchema<SessionRecord>({
  name: 'Session',
  tableName: 'sessions',
  columns: {
    tokenHash: { type: 'text', primary: true, name: 'token_hash' },
    userId: { type: 'uuid', name: 'user_id' },
    createdAt: { type: 'timestamptz', name: 'created_at' },
    expiresAt: { type: 'timestamptz', name: 'expires_at' },
  },
  indices: [{ name: 'sessions_user_id_idx', columns: ['userId'] }],
});

// ── Fase 1. NUMERIC y DATE viajan como string (ver pg-types.ts): nunca pasan por number. ──

export type MarketRecord = {
  code: string;
  name: string;
  country: string;
  currency: string;
  timezone: string;
  defaultWithholdingRate: string;
};

export const MarketSchema = new EntitySchema<MarketRecord>({
  name: 'Market',
  tableName: 'markets',
  columns: {
    code: { type: 'text', primary: true },
    name: { type: 'text' },
    country: { type: 'char', length: 2 },
    currency: { type: 'text' },
    timezone: { type: 'text' },
    defaultWithholdingRate: { type: 'numeric', precision: 7, scale: 6, name: 'default_withholding_rate' },
  },
});

export type InstrumentRecord = {
  id: string;
  symbol: string;
  marketCode: string;
  name: string;
  type: string;
  currency: string;
  sector: string | null;
  industry: string | null;
  withholdingRate: string | null;
  annualDividendPerShare: string | null;
};

export const InstrumentSchema = new EntitySchema<InstrumentRecord>({
  name: 'Instrument',
  tableName: 'instruments',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    symbol: { type: 'text' },
    marketCode: { type: 'text', name: 'market_code' },
    name: { type: 'text' },
    type: { type: 'text' },
    currency: { type: 'text' },
    sector: { type: 'text', nullable: true },
    industry: { type: 'text', nullable: true },
    withholdingRate: { type: 'numeric', precision: 7, scale: 6, nullable: true, name: 'withholding_rate' },
    annualDividendPerShare: { type: 'numeric', precision: 28, scale: 10, nullable: true, name: 'annual_dividend_per_share' },
  },
});

export type AccountRecord = {
  id: string;
  userId: string;
  name: string;
  broker: string;
  baseCurrency: string;
  archived: boolean;
};

export const AccountSchema = new EntitySchema<AccountRecord>({
  name: 'Account',
  tableName: 'accounts',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    userId: { type: 'uuid', name: 'user_id' },
    name: { type: 'text' },
    broker: { type: 'text' },
    baseCurrency: { type: 'text', name: 'base_currency' },
    archived: { type: 'boolean' },
  },
});

export type TradeRecord = {
  id: string;
  userId: string;
  accountId: string;
  instrumentId: string;
  side: string;
  tradeDate: string;
  quantity: string;
  price: string;
  commission: string;
  commissionTax: string;
  currency: string;
  needsReview: boolean;
  notes: string | null;
  createdAt?: Date;
};

export const TradeSchema = new EntitySchema<TradeRecord>({
  name: 'Trade',
  tableName: 'trades',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    userId: { type: 'uuid', name: 'user_id' },
    accountId: { type: 'uuid', name: 'account_id' },
    instrumentId: { type: 'uuid', name: 'instrument_id' },
    side: { type: 'text' },
    tradeDate: { type: 'date', name: 'trade_date' },
    quantity: { type: 'numeric', precision: 28, scale: 10 },
    price: { type: 'numeric', precision: 28, scale: 10 },
    commission: { type: 'numeric', precision: 20, scale: 4 },
    commissionTax: { type: 'numeric', precision: 20, scale: 4, name: 'commission_tax' },
    currency: { type: 'text' },
    needsReview: { type: 'boolean', name: 'needs_review' },
    notes: { type: 'text', nullable: true },
    createdAt: { type: 'timestamptz', name: 'created_at', createDate: true },
  },
});

export type DividendRecord = {
  id: string;
  userId: string;
  accountId: string;
  instrumentId: string;
  status: string;
  kind: string;
  exDate: string | null;
  paymentDate: string;
  currency: string;
  perShare: string | null;
  quantity: string | null;
  grossAmount: string;
  withholdingRate: string;
  withholdingAmount: string;
  netAmount: string;
  notes: string | null;
  createdAt?: Date;
};

export const DividendSchema = new EntitySchema<DividendRecord>({
  name: 'Dividend',
  tableName: 'dividends',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    userId: { type: 'uuid', name: 'user_id' },
    accountId: { type: 'uuid', name: 'account_id' },
    instrumentId: { type: 'uuid', name: 'instrument_id' },
    status: { type: 'text' },
    kind: { type: 'text' },
    exDate: { type: 'date', nullable: true, name: 'ex_date' },
    paymentDate: { type: 'date', name: 'payment_date' },
    currency: { type: 'text' },
    perShare: { type: 'numeric', precision: 28, scale: 10, nullable: true, name: 'per_share' },
    quantity: { type: 'numeric', precision: 28, scale: 10, nullable: true },
    grossAmount: { type: 'numeric', precision: 20, scale: 4, name: 'gross_amount' },
    withholdingRate: { type: 'numeric', precision: 7, scale: 6, name: 'withholding_rate' },
    withholdingAmount: { type: 'numeric', precision: 20, scale: 4, name: 'withholding_amount' },
    netAmount: { type: 'numeric', precision: 20, scale: 4, name: 'net_amount' },
    notes: { type: 'text', nullable: true },
    createdAt: { type: 'timestamptz', name: 'created_at', createDate: true },
  },
});

export type CashMovementRecord = {
  id: string;
  userId: string;
  accountId: string;
  date: string;
  type: string;
  amount: string;
  currency: string;
  description: string | null;
  source: string;
  tradeId: string | null;
  dividendId: string | null;
  transferId: string | null;
  createdAt?: Date;
};

export const CashMovementSchema = new EntitySchema<CashMovementRecord>({
  name: 'CashMovement',
  tableName: 'cash_movements',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    userId: { type: 'uuid', name: 'user_id' },
    accountId: { type: 'uuid', name: 'account_id' },
    date: { type: 'date' },
    type: { type: 'text' },
    amount: { type: 'numeric', precision: 20, scale: 4 },
    currency: { type: 'text' },
    description: { type: 'text', nullable: true },
    source: { type: 'text' },
    tradeId: { type: 'uuid', nullable: true, name: 'trade_id' },
    dividendId: { type: 'uuid', nullable: true, name: 'dividend_id' },
    transferId: { type: 'uuid', nullable: true, name: 'transfer_id' },
    createdAt: { type: 'timestamptz', name: 'created_at', createDate: true },
  },
});
