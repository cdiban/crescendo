import type { Account } from '../../domain/account.ts';
import type { CashMovement, CashMovementType, ImportRole, MovementSource } from '../../domain/cash-movement.ts';
import type { Currency } from '../../domain/currency.ts';
import { Decimal } from '../../domain/decimal.ts';
import type { Dividend, DividendKind, DividendStatus } from '../../domain/dividend.ts';
import type { Instrument, InstrumentType } from '../../domain/instrument.ts';
import type { Market } from '../../domain/market.ts';
import type { Trade, TradeSide } from '../../domain/trade.ts';
import type {
  AccountRecord,
  CashMovementRecord,
  DividendRecord,
  InstrumentRecord,
  MarketRecord,
  TradeRecord,
} from './schemas.ts';

// Los CHECK de la BD garantizan los enums; aquí sólo se reinterpreta el tipo.
const dec = (value: string) => Decimal.parse(value);
const decOrNull = (value: string | null) => (value === null ? null : Decimal.parse(value));
const str = (value: Decimal | null) => (value === null ? null : value.toString());

export const marketMapper = {
  toDomain: (r: MarketRecord): Market => ({
    code: r.code,
    name: r.name,
    country: r.country,
    currency: r.currency as Currency,
    timezone: r.timezone,
    defaultWithholdingRate: dec(r.defaultWithholdingRate),
  }),
};

export const instrumentMapper = {
  toDomain: (r: InstrumentRecord): Instrument => ({
    id: r.id,
    symbol: r.symbol,
    marketCode: r.marketCode,
    name: r.name,
    type: r.type as InstrumentType,
    currency: r.currency as Currency,
    sector: r.sector,
    industry: r.industry,
    withholdingRate: decOrNull(r.withholdingRate),
    annualDividendPerShare: decOrNull(r.annualDividendPerShare),
    priceSymbol: r.priceSymbol,
    priceSyncedSymbol: r.priceSyncedSymbol,
  }),
  toRecord: (i: Omit<Instrument, 'id'> & { id?: string }): Partial<InstrumentRecord> => ({
    ...(i.id ? { id: i.id } : {}),
    symbol: i.symbol,
    marketCode: i.marketCode,
    name: i.name,
    type: i.type,
    currency: i.currency,
    sector: i.sector,
    industry: i.industry,
    withholdingRate: str(i.withholdingRate),
    annualDividendPerShare: str(i.annualDividendPerShare),
    priceSymbol: i.priceSymbol,
    priceSyncedSymbol: i.priceSyncedSymbol,
  }),
};

export const accountMapper = {
  toDomain: (r: AccountRecord): Account => ({
    id: r.id,
    userId: r.userId,
    name: r.name,
    broker: r.broker,
    baseCurrency: r.baseCurrency as Currency,
    archived: r.archived,
  }),
};

export const tradeMapper = {
  toDomain: (r: TradeRecord): Trade => ({
    id: r.id,
    userId: r.userId,
    accountId: r.accountId,
    instrumentId: r.instrumentId,
    side: r.side as TradeSide,
    tradeDate: r.tradeDate,
    quantity: dec(r.quantity),
    price: dec(r.price),
    commission: dec(r.commission),
    commissionTax: dec(r.commissionTax),
    currency: r.currency as Currency,
    needsReview: r.needsReview,
    notes: r.notes,
  }),
  toRecord: (t: Omit<Trade, 'id'> & { id?: string }): Partial<TradeRecord> => ({
    ...(t.id ? { id: t.id } : {}),
    userId: t.userId,
    accountId: t.accountId,
    instrumentId: t.instrumentId,
    side: t.side,
    tradeDate: t.tradeDate,
    quantity: t.quantity.toString(),
    price: t.price.toString(),
    commission: t.commission.toString(),
    commissionTax: t.commissionTax.toString(),
    currency: t.currency,
    needsReview: t.needsReview,
    notes: t.notes,
  }),
};

export const dividendMapper = {
  toDomain: (r: DividendRecord): Dividend => ({
    id: r.id,
    userId: r.userId,
    accountId: r.accountId,
    instrumentId: r.instrumentId,
    status: r.status as DividendStatus,
    kind: r.kind as DividendKind,
    exDate: r.exDate,
    paymentDate: r.paymentDate,
    currency: r.currency as Currency,
    perShare: decOrNull(r.perShare),
    quantity: decOrNull(r.quantity),
    grossAmount: dec(r.grossAmount),
    withholdingRate: dec(r.withholdingRate),
    withholdingAmount: dec(r.withholdingAmount),
    netAmount: dec(r.netAmount),
    notes: r.notes,
  }),
  toRecord: (d: Omit<Dividend, 'id'> & { id?: string }): Partial<DividendRecord> => ({
    ...(d.id ? { id: d.id } : {}),
    userId: d.userId,
    accountId: d.accountId,
    instrumentId: d.instrumentId,
    status: d.status,
    kind: d.kind,
    exDate: d.exDate,
    paymentDate: d.paymentDate,
    currency: d.currency,
    perShare: str(d.perShare),
    quantity: str(d.quantity),
    grossAmount: d.grossAmount.toString(),
    withholdingRate: d.withholdingRate.toString(),
    withholdingAmount: d.withholdingAmount.toString(),
    netAmount: d.netAmount.toString(),
    notes: d.notes,
  }),
};

export const cashMovementMapper = {
  toDomain: (r: CashMovementRecord): CashMovement => ({
    id: r.id,
    userId: r.userId,
    accountId: r.accountId,
    date: r.date,
    type: r.type as CashMovementType,
    amount: dec(r.amount),
    currency: r.currency as Currency,
    description: r.description,
    source: r.source as MovementSource,
    importRole: r.importRole as ImportRole | null,
    tradeId: r.tradeId,
    dividendId: r.dividendId,
    transferId: r.transferId,
  }),
  toRecord: (m: Omit<CashMovement, 'id'> & { id?: string }): Partial<CashMovementRecord> => ({
    ...(m.id ? { id: m.id } : {}),
    userId: m.userId,
    accountId: m.accountId,
    date: m.date,
    type: m.type,
    amount: m.amount.toString(),
    currency: m.currency,
    description: m.description,
    source: m.source,
    importRole: m.importRole,
    tradeId: m.tradeId,
    dividendId: m.dividendId,
    transferId: m.transferId,
  }),
};
