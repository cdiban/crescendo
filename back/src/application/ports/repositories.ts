import type { Account, NewAccount } from '../../domain/account.ts';
import type { CashMovement, CashMovementType, NewCashMovement } from '../../domain/cash-movement.ts';
import type { Currency } from '../../domain/currency.ts';
import type { Decimal } from '../../domain/decimal.ts';
import type { Dividend, DividendStatus, NewDividend } from '../../domain/dividend.ts';
import type { FxQuote } from '../../domain/fx.ts';
import type { FetchedFxQuote } from './fx-rate-provider.ts';
import type { Instrument, NewInstrument } from '../../domain/instrument.ts';
import type { Market } from '../../domain/market.ts';
import type { PriceSource } from '../../domain/market-data.ts';
import type { NewTrade, Trade } from '../../domain/trade.ts';
import type { Page, PageRequest } from './page.ts';
import type { UserRepository } from './user-repository.ts';

// Todo lo que no es catálogo se consulta siempre con el userId del dueño:
// un recurso de otro usuario es, para todos los efectos, inexistente.

export interface MarketRepository {
  list(): Promise<Market[]>;
  findByCode(code: string): Promise<Market | null>;
}

export type InstrumentFilter = PageRequest & { q?: string | undefined; marketCode?: string | undefined };

export interface InstrumentRepository {
  search(filter: InstrumentFilter): Promise<Page<Instrument>>;
  findById(id: string): Promise<Instrument | null>;
  findByIds(ids: readonly string[]): Promise<Instrument[]>;
  findBySymbol(symbol: string, marketCode: string): Promise<Instrument | null>;
  /** Lanza ConflictError si ya existe símbolo + mercado. */
  add(instrument: NewInstrument): Promise<Instrument>;
  update(instrument: Instrument): Promise<void>;
  /** Instrumentos creados desde `since` (para traer su precio aunque aún no tengan operaciones). */
  createdSince(since: Date): Promise<Instrument[]>;
}

export type StoredQuote = {
  price: Decimal;
  previousClose: Decimal | null;
  asOf: Date;
  /** Fecha local de la bolsa. */
  date: string;
  source: PriceSource;
};

export type StoredClose = { date: string; close: Decimal; source: PriceSource };

export interface PriceRepository {
  quotes(instrumentIds: readonly string[]): Promise<Map<string, StoredQuote>>;
  /** Cotización del proveedor; no pisa un MANUAL de la misma fecha o posterior. Devuelve si la guardó. */
  saveProviderQuote(instrumentId: string, quote: Omit<StoredQuote, 'source'>): Promise<boolean>;
  saveManualQuote(instrumentId: string, quote: Omit<StoredQuote, 'source'>): Promise<void>;
  /** Cierres del proveedor; nunca pisan un cierre MANUAL. Devuelve cuántas filas cambiaron. */
  saveProviderCloses(instrumentId: string, closes: ReadonlyArray<{ date: string; close: Decimal }>): Promise<number>;
  saveManualClose(instrumentId: string, date: string, close: Decimal): Promise<void>;
  closes(instrumentId: string, from: string, to: string): Promise<StoredClose[]>;
  /** Cierres ≤ `to` de varios instrumentos, ascendentes por fecha (para la serie histórica). */
  closesUpTo(instrumentIds: readonly string[], to: string): Promise<Map<string, StoredClose[]>>;
  /** Último cierre en o antes de `date` por instrumento. */
  latestCloses(instrumentIds: readonly string[], date: string): Promise<Map<string, StoredClose>>;
  lastCloseDate(instrumentId: string): Promise<string | null>;
  /** Borra cierres y cotización del proveedor (al cambiar el símbolo); conserva los MANUAL. */
  clearProviderData(instrumentId: string): Promise<void>;
}

/** Vista global (todos los usuarios) que necesita el worker para decidir qué precios traer. */
export type TradedInstrument = { instrumentId: string; firstTradeDate: string; open: boolean };

export interface AccountRepository {
  listByUser(userId: string): Promise<Account[]>;
  countByUser(userId: string): Promise<number>;
  findById(userId: string, id: string): Promise<Account | null>;
  /** Igual que findById pero bloquea la fila hasta el fin de la transacción. */
  lock(userId: string, id: string): Promise<Account | null>;
  /** Lanza ConflictError si el nombre ya existe para el usuario. */
  add(account: NewAccount): Promise<Account>;
  update(account: Account): Promise<void>;
}

export type TradeFilter = PageRequest & {
  accountId?: string | undefined;
  instrumentId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  needsReview?: boolean | undefined;
};

export interface TradeRepository {
  search(userId: string, filter: TradeFilter): Promise<Page<Trade>>;
  findById(userId: string, id: string): Promise<Trade | null>;
  listByUser(userId: string, filter?: { accountId?: string | undefined; instrumentId?: string | undefined }): Promise<Trade[]>;
  add(trade: NewTrade): Promise<Trade>;
  update(trade: Trade): Promise<void>;
  delete(userId: string, id: string): Promise<void>;
  /** Global, sin filtrar por usuario: instrumentos con operaciones, su primera fecha y si alguien tiene posición abierta. */
  tradedInstruments(): Promise<TradedInstrument[]>;
}

export type DividendQuery = {
  accountId?: string | undefined;
  instrumentId?: string | undefined;
  status?: DividendStatus | undefined;
  from?: string | undefined;
  to?: string | undefined;
};

export interface DividendRepository {
  search(userId: string, filter: DividendQuery & PageRequest): Promise<Page<Dividend>>;
  listByUser(userId: string, filter: DividendQuery): Promise<Dividend[]>;
  findById(userId: string, id: string): Promise<Dividend | null>;
  add(dividend: NewDividend): Promise<Dividend>;
  update(dividend: Dividend): Promise<void>;
  delete(userId: string, id: string): Promise<void>;
}

export type CashMovementFilter = PageRequest & {
  accountId?: string | undefined;
  currency?: Currency | undefined;
  type?: CashMovementType | undefined;
  from?: string | undefined;
  to?: string | undefined;
};

export type CashBalance = { accountId: string; currency: Currency; amount: Decimal };

export interface CashMovementRepository {
  search(userId: string, filter: CashMovementFilter): Promise<Page<CashMovement>>;
  findById(userId: string, id: string): Promise<CashMovement | null>;
  findByTradeId(userId: string, tradeId: string): Promise<CashMovement | null>;
  findByDividendId(userId: string, dividendId: string): Promise<CashMovement | null>;
  /** dividendId → id de su movimiento, para los dividendos que lo tienen. */
  movementIdsByDividend(userId: string, dividendIds: readonly string[]): Promise<Map<string, string>>;
  listByTransferId(userId: string, transferId: string): Promise<CashMovement[]>;
  add(movement: NewCashMovement): Promise<CashMovement>;
  update(movement: CashMovement): Promise<void>;
  delete(userId: string, id: string): Promise<void>;
  /** Movimientos del usuario con fecha ≤ `to` (todos si se omite), más antiguos primero. */
  listByUser(userId: string, filter?: { to?: string | undefined }): Promise<CashMovement[]>;
  /** Saldo = suma de movimientos, por cuenta y moneda. */
  balances(userId: string, accountId?: string): Promise<CashBalance[]>;
}

export interface FxRateRepository {
  /** Inserta o actualiza por (moneda, fecha). Devuelve cuántas filas cambiaron (0 si ya estaba todo igual). */
  upsert(quotes: readonly FetchedFxQuote[]): Promise<number>;
  /** Todos los datos con fecha ≤ `date` (todas las monedas). */
  listUpTo(date: string): Promise<FetchedFxQuote[]>;
  /** Última fecha cargada de `currency` dentro del año, o null. */
  lastDateInYear(currency: FxQuote['currency'], year: number): Promise<string | null>;
}

export type Repositories = {
  users: UserRepository;
  markets: MarketRepository;
  instruments: InstrumentRepository;
  accounts: AccountRepository;
  trades: TradeRepository;
  dividends: DividendRepository;
  cashMovements: CashMovementRepository;
  fxRates: FxRateRepository;
  prices: PriceRepository;
};
