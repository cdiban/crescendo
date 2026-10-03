import { In, type EntityManager, type SelectQueryBuilder, type ObjectLiteral } from 'typeorm';
import type { Account, NewAccount } from '../../domain/account.ts';
import type { CashMovement, NewCashMovement } from '../../domain/cash-movement.ts';
import type { Currency } from '../../domain/currency.ts';
import { Decimal } from '../../domain/decimal.ts';
import type { Dividend, NewDividend } from '../../domain/dividend.ts';
import type { Instrument, NewInstrument } from '../../domain/instrument.ts';
import type { Market } from '../../domain/market.ts';
import type { NewTrade, Trade } from '../../domain/trade.ts';
import { ConflictError } from '../../application/errors.ts';
import type { Page, PageRequest } from '../../application/ports/page.ts';
import type {
  AccountRepository,
  CashBalance,
  CashMovementFilter,
  CashMovementRepository,
  DividendQuery,
  DividendRepository,
  InstrumentFilter,
  InstrumentRepository,
  MarketRepository,
  Repositories,
  TradeFilter,
  TradeRepository,
} from '../../application/ports/repositories.ts';
import { isUniqueViolation } from './errors.ts';
import {
  accountMapper,
  cashMovementMapper,
  dividendMapper,
  instrumentMapper,
  marketMapper,
  tradeMapper,
} from './mappers.ts';
import {
  AccountSchema,
  CashMovementSchema,
  DividendSchema,
  InstrumentSchema,
  MarketSchema,
  TradeSchema,
} from './schemas.ts';
import { TypeOrmFxRateRepository } from './typeorm-fx-rate-repository.ts';
import { TypeOrmUserRepository } from './typeorm-user-repository.ts';

async function page<R extends ObjectLiteral, T>(
  qb: SelectQueryBuilder<R>,
  { limit, offset }: PageRequest,
  toDomain: (record: R) => T,
): Promise<Page<T>> {
  const [records, total] = await qb.take(limit).skip(offset).getManyAndCount();
  return { items: records.map(toDomain), total };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Filtros de fecha inclusivos comunes. */
function dateRange<R extends ObjectLiteral>(qb: SelectQueryBuilder<R>, column: string, from?: string, to?: string) {
  if (from) qb.andWhere(`${column} >= :from`, { from });
  if (to) qb.andWhere(`${column} <= :to`, { to });
}

export class TypeOrmMarketRepository implements MarketRepository {
  readonly #m: EntityManager;
  constructor(manager: EntityManager) {
    this.#m = manager;
  }

  async list(): Promise<Market[]> {
    return (await this.#m.getRepository(MarketSchema).find({ order: { code: 'ASC' } })).map(marketMapper.toDomain);
  }

  async findByCode(code: string): Promise<Market | null> {
    const r = await this.#m.getRepository(MarketSchema).findOneBy({ code });
    return r ? marketMapper.toDomain(r) : null;
  }
}

export class TypeOrmInstrumentRepository implements InstrumentRepository {
  readonly #m: EntityManager;
  constructor(manager: EntityManager) {
    this.#m = manager;
  }

  #repo() {
    return this.#m.getRepository(InstrumentSchema);
  }

  search(filter: InstrumentFilter): Promise<Page<Instrument>> {
    const qb = this.#repo().createQueryBuilder('i').orderBy('i.symbol', 'ASC').addOrderBy('i.market_code', 'ASC');
    if (filter.q) {
      qb.andWhere('(i.symbol ILIKE :q OR i.name ILIKE :q)', { q: `%${escapeLike(filter.q)}%` });
    }
    if (filter.marketCode) qb.andWhere('i.market_code = :marketCode', { marketCode: filter.marketCode });
    return page(qb, filter, instrumentMapper.toDomain);
  }

  async findById(id: string): Promise<Instrument | null> {
    const r = await this.#repo().findOneBy({ id });
    return r ? instrumentMapper.toDomain(r) : null;
  }

  async findByIds(ids: readonly string[]): Promise<Instrument[]> {
    if (ids.length === 0) return [];
    return (await this.#repo().findBy({ id: In([...ids]) })).map(instrumentMapper.toDomain);
  }

  async findBySymbol(symbol: string, marketCode: string): Promise<Instrument | null> {
    const r = await this.#repo().findOneBy({ symbol, marketCode });
    return r ? instrumentMapper.toDomain(r) : null;
  }

  async add(instrument: NewInstrument): Promise<Instrument> {
    try {
      const r = await this.#repo().save(this.#repo().create(instrumentMapper.toRecord(instrument)));
      return instrumentMapper.toDomain(r);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('Ya existe ese símbolo en ese mercado');
      throw err;
    }
  }

  async update(instrument: Instrument): Promise<void> {
    await this.#repo().update({ id: instrument.id }, instrumentMapper.toRecord(instrument));
  }
}

export class TypeOrmAccountRepository implements AccountRepository {
  readonly #m: EntityManager;
  constructor(manager: EntityManager) {
    this.#m = manager;
  }

  #repo() {
    return this.#m.getRepository(AccountSchema);
  }

  async listByUser(userId: string): Promise<Account[]> {
    return (await this.#repo().find({ where: { userId }, order: { name: 'ASC' } })).map(accountMapper.toDomain);
  }

  countByUser(userId: string): Promise<number> {
    return this.#repo().countBy({ userId });
  }

  async findById(userId: string, id: string): Promise<Account | null> {
    const r = await this.#repo().findOneBy({ id, userId });
    return r ? accountMapper.toDomain(r) : null;
  }

  async lock(userId: string, id: string): Promise<Account | null> {
    const r = await this.#repo()
      .createQueryBuilder('a')
      .setLock('pessimistic_write')
      .where('a.id = :id AND a.user_id = :userId', { id, userId })
      .getOne();
    return r ? accountMapper.toDomain(r) : null;
  }

  async add(account: NewAccount): Promise<Account> {
    try {
      return accountMapper.toDomain(await this.#repo().save(this.#repo().create({ ...account })));
    } catch (err) {
      if (isUniqueViolation(err, 'accounts_user_name_unique')) throw new ConflictError('Ya existe una cuenta con ese nombre');
      throw err;
    }
  }

  async update(account: Account): Promise<void> {
    try {
      const { id, userId, ...fields } = account;
      await this.#repo().update({ id, userId }, fields);
    } catch (err) {
      if (isUniqueViolation(err, 'accounts_user_name_unique')) throw new ConflictError('Ya existe una cuenta con ese nombre');
      throw err;
    }
  }
}

export class TypeOrmTradeRepository implements TradeRepository {
  readonly #m: EntityManager;
  constructor(manager: EntityManager) {
    this.#m = manager;
  }

  #repo() {
    return this.#m.getRepository(TradeSchema);
  }

  search(userId: string, f: TradeFilter): Promise<Page<Trade>> {
    const qb = this.#repo()
      .createQueryBuilder('t')
      .where('t.user_id = :userId', { userId })
      .orderBy('t.trade_date', 'DESC')
      .addOrderBy('t.created_at', 'DESC')
      .addOrderBy('t.id', 'ASC');
    if (f.accountId) qb.andWhere('t.account_id = :accountId', { accountId: f.accountId });
    if (f.instrumentId) qb.andWhere('t.instrument_id = :instrumentId', { instrumentId: f.instrumentId });
    if (f.needsReview !== undefined) qb.andWhere('t.needs_review = :needsReview', { needsReview: f.needsReview });
    dateRange(qb, 't.trade_date', f.from, f.to);
    return page(qb, f, tradeMapper.toDomain);
  }

  async findById(userId: string, id: string): Promise<Trade | null> {
    const r = await this.#repo().findOneBy({ id, userId });
    return r ? tradeMapper.toDomain(r) : null;
  }

  async listByUser(userId: string, filter: { accountId?: string; instrumentId?: string } = {}): Promise<Trade[]> {
    const where = {
      userId,
      ...(filter.accountId ? { accountId: filter.accountId } : {}),
      ...(filter.instrumentId ? { instrumentId: filter.instrumentId } : {}),
    };
    const records = await this.#repo().find({ where, order: { tradeDate: 'ASC', createdAt: 'ASC', id: 'ASC' } });
    return records.map(tradeMapper.toDomain);
  }

  async add(trade: NewTrade): Promise<Trade> {
    return tradeMapper.toDomain(await this.#repo().save(this.#repo().create(tradeMapper.toRecord(trade))));
  }

  async update(trade: Trade): Promise<void> {
    const { id, userId, ...fields } = tradeMapper.toRecord(trade);
    await this.#repo().update({ id: trade.id, userId: trade.userId }, fields);
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.#repo().delete({ id, userId });
  }
}

export class TypeOrmDividendRepository implements DividendRepository {
  readonly #m: EntityManager;
  constructor(manager: EntityManager) {
    this.#m = manager;
  }

  #repo() {
    return this.#m.getRepository(DividendSchema);
  }

  #query(userId: string, f: DividendQuery) {
    const qb = this.#repo().createQueryBuilder('d').where('d.user_id = :userId', { userId });
    if (f.accountId) qb.andWhere('d.account_id = :accountId', { accountId: f.accountId });
    if (f.instrumentId) qb.andWhere('d.instrument_id = :instrumentId', { instrumentId: f.instrumentId });
    if (f.status) qb.andWhere('d.status = :status', { status: f.status });
    dateRange(qb, 'd.payment_date', f.from, f.to);
    return qb;
  }

  search(userId: string, f: DividendQuery & PageRequest): Promise<Page<Dividend>> {
    const qb = this.#query(userId, f)
      .orderBy('d.payment_date', 'DESC')
      .addOrderBy('d.created_at', 'DESC')
      .addOrderBy('d.id', 'ASC');
    return page(qb, f, dividendMapper.toDomain);
  }

  async listByUser(userId: string, f: DividendQuery): Promise<Dividend[]> {
    const records = await this.#query(userId, f).orderBy('d.payment_date', 'ASC').addOrderBy('d.id', 'ASC').getMany();
    return records.map(dividendMapper.toDomain);
  }

  async findById(userId: string, id: string): Promise<Dividend | null> {
    const r = await this.#repo().findOneBy({ id, userId });
    return r ? dividendMapper.toDomain(r) : null;
  }

  async add(dividend: NewDividend): Promise<Dividend> {
    return dividendMapper.toDomain(await this.#repo().save(this.#repo().create(dividendMapper.toRecord(dividend))));
  }

  async update(dividend: Dividend): Promise<void> {
    const { id, userId, ...fields } = dividendMapper.toRecord(dividend);
    await this.#repo().update({ id: dividend.id, userId: dividend.userId }, fields);
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.#repo().delete({ id, userId });
  }
}

export class TypeOrmCashMovementRepository implements CashMovementRepository {
  readonly #m: EntityManager;
  constructor(manager: EntityManager) {
    this.#m = manager;
  }

  #repo() {
    return this.#m.getRepository(CashMovementSchema);
  }

  search(userId: string, f: CashMovementFilter): Promise<Page<CashMovement>> {
    const qb = this.#repo()
      .createQueryBuilder('c')
      .where('c.user_id = :userId', { userId })
      .orderBy('c.date', 'DESC')
      .addOrderBy('c.created_at', 'DESC')
      .addOrderBy('c.id', 'ASC');
    if (f.accountId) qb.andWhere('c.account_id = :accountId', { accountId: f.accountId });
    if (f.currency) qb.andWhere('c.currency = :currency', { currency: f.currency });
    if (f.type) qb.andWhere('c.type = :type', { type: f.type });
    dateRange(qb, 'c.date', f.from, f.to);
    return page(qb, f, cashMovementMapper.toDomain);
  }

  async findById(userId: string, id: string): Promise<CashMovement | null> {
    const r = await this.#repo().findOneBy({ id, userId });
    return r ? cashMovementMapper.toDomain(r) : null;
  }

  async findByTradeId(userId: string, tradeId: string): Promise<CashMovement | null> {
    const r = await this.#repo().findOneBy({ tradeId, userId });
    return r ? cashMovementMapper.toDomain(r) : null;
  }

  async findByDividendId(userId: string, dividendId: string): Promise<CashMovement | null> {
    const r = await this.#repo().findOneBy({ dividendId, userId });
    return r ? cashMovementMapper.toDomain(r) : null;
  }

  async movementIdsByDividend(userId: string, dividendIds: readonly string[]): Promise<Map<string, string>> {
    if (dividendIds.length === 0) return new Map();
    const records = await this.#repo().find({ select: { id: true, dividendId: true }, where: { userId, dividendId: In([...dividendIds]) } });
    return new Map(records.map((r) => [r.dividendId!, r.id]));
  }

  async listByTransferId(userId: string, transferId: string): Promise<CashMovement[]> {
    const records = await this.#repo().find({ where: { transferId, userId }, order: { amount: 'ASC' } });
    return records.map(cashMovementMapper.toDomain);
  }

  async add(movement: NewCashMovement): Promise<CashMovement> {
    return cashMovementMapper.toDomain(await this.#repo().save(this.#repo().create(cashMovementMapper.toRecord(movement))));
  }

  async update(movement: CashMovement): Promise<void> {
    const { id, userId, ...fields } = cashMovementMapper.toRecord(movement);
    await this.#repo().update({ id: movement.id, userId: movement.userId }, fields);
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.#repo().delete({ id, userId });
  }

  async listByUser(userId: string, filter: { to?: string | undefined } = {}): Promise<CashMovement[]> {
    const qb = this.#repo().createQueryBuilder('c').where('c.user_id = :userId', { userId }).orderBy('c.date', 'ASC').addOrderBy('c.id', 'ASC');
    if (filter.to) qb.andWhere('c.date <= :to', { to: filter.to });
    return (await qb.getMany()).map(cashMovementMapper.toDomain);
  }

  async balances(userId: string, accountId?: string): Promise<CashBalance[]> {
    const qb = this.#repo()
      .createQueryBuilder('c')
      .select('c.account_id', 'accountId')
      .addSelect('c.currency', 'currency')
      .addSelect('SUM(c.amount)::text', 'amount')
      .where('c.user_id = :userId', { userId })
      .groupBy('c.account_id')
      .addGroupBy('c.currency')
      .orderBy('c.currency', 'ASC');
    if (accountId) qb.andWhere('c.account_id = :accountId', { accountId });
    const rows = await qb.getRawMany<{ accountId: string; currency: string; amount: string }>();
    return rows.map((r) => ({ accountId: r.accountId, currency: r.currency as Currency, amount: Decimal.parse(r.amount) }));
  }
}

export function createRepositories(manager: EntityManager): Repositories {
  return {
    users: new TypeOrmUserRepository(manager),
    markets: new TypeOrmMarketRepository(manager),
    instruments: new TypeOrmInstrumentRepository(manager),
    accounts: new TypeOrmAccountRepository(manager),
    trades: new TypeOrmTradeRepository(manager),
    dividends: new TypeOrmDividendRepository(manager),
    cashMovements: new TypeOrmCashMovementRepository(manager),
    fxRates: new TypeOrmFxRateRepository(manager),
  };
}
