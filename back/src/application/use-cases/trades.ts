import type { Decimal } from '../../domain/decimal.ts';
import { InsufficientPositionError } from '../../domain/errors.ts';
import type { Instrument } from '../../domain/instrument.ts';
import { firstNegativeQuantityDate } from '../../domain/positions.ts';
import { tradeAmounts, type NewTrade, type Trade, type TradeSide } from '../../domain/trade.ts';
import { NotFoundError } from '../errors.ts';
import type { Page } from '../ports/page.ts';
import type { Repositories, TradeFilter } from '../ports/repositories.ts';
import type { UnitOfWork } from '../ports/unit-of-work.ts';
import { assertNotArchived, failIf, lockAccount, lockAccounts, requireInstrument } from './shared.ts';

export type TradeInput = {
  accountId: string;
  instrumentId: string;
  side: TradeSide;
  tradeDate: string;
  quantity: Decimal;
  price: Decimal;
  commission: Decimal;
  commissionTax: Decimal;
  needsReview: boolean;
  notes: string | null;
};

export type TradeView = Trade & { symbol: string; grossAmount: Decimal; total: Decimal };

function validate(input: TradeInput): void {
  failIf([
    !input.quantity.isPositive() && { field: 'quantity', message: 'Debe ser mayor que 0' },
    !input.price.isPositive() && { field: 'price', message: 'Debe ser mayor que 0' },
    input.commission.isNegative() && { field: 'commission', message: 'No puede ser negativa' },
    input.commissionTax.isNegative() && { field: 'commissionTax', message: 'No puede ser negativo' },
  ]);
}

function toView(trade: Trade, symbol: string): TradeView {
  const { grossAmount, total } = tradeAmounts(trade);
  return { ...trade, symbol, grossAmount, total };
}

async function views(r: Repositories, trades: Trade[]): Promise<TradeView[]> {
  const ids = [...new Set(trades.map((t) => t.instrumentId))];
  const symbols = new Map((await r.instruments.findByIds(ids)).map((i) => [i.id, i.symbol]));
  return trades.map((t) => toView(t, symbols.get(t.instrumentId)!));
}

/**
 * La posición (cuenta + instrumento) no puede quedar negativa al cierre de ninguna fecha
 * tras aplicar el cambio: `without` sale del historial y `withTrade` entra.
 */
async function assertPositionNeverNegative(
  r: Repositories,
  userId: string,
  accountId: string,
  instrumentId: string,
  change: { without?: string; withTrade?: Pick<Trade, 'side' | 'tradeDate' | 'quantity'> },
): Promise<void> {
  const history = (await r.trades.listByUser(userId, { accountId, instrumentId })).filter((t) => t.id !== change.without);
  const date = firstNegativeQuantityDate(change.withTrade ? [...history, change.withTrade] : history);
  if (date) throw new InsufficientPositionError(date);
}

function movementDescription(trade: Pick<Trade, 'side' | 'quantity'>, instrument: Instrument): string {
  return `${trade.side === 'BUY' ? 'Compra' : 'Venta'} ${trade.quantity.toString()} ${instrument.symbol}`;
}

export class Trades {
  readonly #uow: UnitOfWork;

  constructor(deps: { uow: UnitOfWork }) {
    this.#uow = deps.uow;
  }

  list(userId: string, filter: TradeFilter): Promise<Page<TradeView>> {
    return this.#uow.read(async (r) => {
      const result = await r.trades.search(userId, filter);
      return { items: await views(r, result.items), total: result.total };
    });
  }

  get(userId: string, id: string): Promise<TradeView> {
    return this.#uow.read(async (r) => {
      const trade = await r.trades.findById(userId, id);
      if (!trade) throw new NotFoundError('La operación');
      return (await views(r, [trade]))[0]!;
    });
  }

  /** Crea la operación y su movimiento de caja TRADE en la misma transacción. */
  create(userId: string, input: TradeInput): Promise<TradeView> {
    return this.#uow.transaction(async (r) => {
      const account = await lockAccount(r, userId, input.accountId);
      assertNotArchived(account);
      const instrument = await requireInstrument(r, input.instrumentId);
      validate(input);

      const candidate: NewTrade = { ...input, userId, currency: instrument.currency };
      await assertPositionNeverNegative(r, userId, account.id, instrument.id, { withTrade: candidate });

      const trade = await r.trades.add(candidate);
      await r.cashMovements.add({
        userId,
        accountId: account.id,
        date: trade.tradeDate,
        type: 'TRADE',
        amount: tradeAmounts(trade).cashAmount,
        currency: trade.currency,
        description: movementDescription(trade, instrument),
        source: 'AUTOMATIC',
        importRole: null,
        tradeId: trade.id,
        dividendId: null,
        transferId: null,
      });
      return toView(trade, instrument.symbol);
    });
  }

  /** Reemplaza todos los campos y recalcula su movimiento de caja. */
  replace(userId: string, id: string, input: TradeInput): Promise<TradeView> {
    return this.#uow.transaction(async (r) => {
      const current = await r.trades.findById(userId, id);
      if (!current) throw new NotFoundError('La operación');
      const accounts = await lockAccounts(r, userId, [current.accountId, input.accountId]);
      const target = accounts.get(input.accountId)!;
      if (target.id !== current.accountId) assertNotArchived(target);
      const instrument = await requireInstrument(r, input.instrumentId);
      validate(input);

      const updated: Trade = { ...input, id, userId, currency: instrument.currency };
      const samePosition = current.accountId === updated.accountId && current.instrumentId === updated.instrumentId;
      await assertPositionNeverNegative(r, userId, updated.accountId, updated.instrumentId, { without: id, withTrade: updated });
      if (!samePosition) {
        await assertPositionNeverNegative(r, userId, current.accountId, current.instrumentId, { without: id });
      }

      await r.trades.update(updated);
      const movement = await r.cashMovements.findByTradeId(userId, id);
      if (!movement) throw new Error(`La operación ${id} no tiene movimiento de caja`);
      await r.cashMovements.update({
        ...movement,
        accountId: updated.accountId,
        date: updated.tradeDate,
        amount: tradeAmounts(updated).cashAmount,
        currency: updated.currency,
        description: movementDescription(updated, instrument),
      });
      return toView(updated, instrument.symbol);
    });
  }

  /** Borra la operación y su movimiento de caja. */
  delete(userId: string, id: string): Promise<void> {
    return this.#uow.transaction(async (r) => {
      const current = await r.trades.findById(userId, id);
      if (!current) throw new NotFoundError('La operación');
      await lockAccount(r, userId, current.accountId);
      await assertPositionNeverNegative(r, userId, current.accountId, current.instrumentId, { without: id });
      // El movimiento se elimina en cascada (FK), pero se borra explícito para no depender de ello.
      const movement = await r.cashMovements.findByTradeId(userId, id);
      if (movement) await r.cashMovements.delete(userId, movement.id);
      await r.trades.delete(userId, id);
    });
  }
}
