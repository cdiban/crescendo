import type { Account } from '../../domain/account.ts';
import type { Decimal } from '../../domain/decimal.ts';
import {
  computeDividendAmounts,
  type Dividend,
  type DividendKind,
  type DividendStatus,
  type NewDividend,
} from '../../domain/dividend.ts';
import { BusinessRuleError, InvalidDividendAmountError } from '../../domain/errors.ts';
import { effectiveWithholdingRate, type Instrument } from '../../domain/instrument.ts';
import { quantityAt } from '../../domain/positions.ts';
import { NotFoundError, ValidationError } from '../errors.ts';
import type { Page, PageRequest } from '../ports/page.ts';
import type { DividendQuery, Repositories } from '../ports/repositories.ts';
import type { UnitOfWork } from '../ports/unit-of-work.ts';
import { assertNotArchived, lockAccount, lockAccounts, requireInstrument } from './shared.ts';

export type DividendInput = {
  accountId: string;
  instrumentId: string;
  status: DividendStatus;
  kind: DividendKind;
  exDate: string | null;
  paymentDate: string;
  grossAmount?: Decimal | undefined;
  perShare?: Decimal | undefined;
  quantity?: Decimal | undefined;
  withholdingRate?: Decimal | undefined;
  notes: string | null;
  /** Neto efectivamente recibido: fija el neto y ajusta la retención (contrato v0.2.1). */
  netAmount?: Decimal | undefined;
};

export type DividendView = Dividend & { symbol: string; cashMovementId: string | null };

async function views(r: Repositories, userId: string, dividends: Dividend[]): Promise<DividendView[]> {
  const ids = [...new Set(dividends.map((d) => d.instrumentId))];
  const symbols = new Map((await r.instruments.findByIds(ids)).map((i) => [i.id, i.symbol]));
  const movements = await r.cashMovements.movementIdsByDividend(userId, dividends.map((d) => d.id));
  return dividends.map((d) => ({ ...d, symbol: symbols.get(d.instrumentId)!, cashMovementId: movements.get(d.id) ?? null }));
}

/** Aplica las reglas de monto, cantidad y retención a la entrada. */
async function build(r: Repositories, userId: string, account: Account, instrument: Instrument, input: DividendInput): Promise<NewDividend> {
  let quantity = input.quantity;
  if (input.perShare !== undefined && quantity === undefined) {
    const trades = await r.trades.listByUser(userId, { accountId: account.id, instrumentId: instrument.id });
    const held = quantityAt(trades, input.exDate ?? input.paymentDate);
    if (!held.isPositive()) {
      throw new BusinessRuleError('NO_POSITION_FOR_DIVIDEND', 'No hay posición en esa fecha para calcular el dividendo por acción');
    }
    quantity = held;
  }

  const market = (await r.markets.findByCode(instrument.marketCode))!;
  const withholdingRate = input.withholdingRate ?? effectiveWithholdingRate(instrument, market);
  let amounts;
  try {
    amounts = computeDividendAmounts({
      currency: instrument.currency,
      withholdingRate,
      grossAmount: input.grossAmount,
      perShare: input.perShare,
      quantity,
      netAmount: input.netAmount,
    });
  } catch (err) {
    if (err instanceof InvalidDividendAmountError) throw new ValidationError([{ field: err.field, message: err.message }]);
    throw err;
  }

  return {
    userId,
    accountId: account.id,
    instrumentId: instrument.id,
    status: input.status,
    kind: input.kind,
    exDate: input.exDate,
    paymentDate: input.paymentDate,
    currency: instrument.currency,
    perShare: input.perShare ?? null,
    quantity: input.perShare !== undefined ? (quantity ?? null) : null,
    withholdingRate,
    ...amounts,
    notes: input.notes,
  };
}

/** Deja el movimiento DIVIDEND acorde al estado: PAID ⇒ existe por el neto; ANNOUNCED ⇒ no existe. */
async function syncMovement(r: Repositories, dividend: Dividend, symbol: string): Promise<void> {
  const existing = await r.cashMovements.findByDividendId(dividend.userId, dividend.id);
  if (dividend.status !== 'PAID') {
    if (existing) await r.cashMovements.delete(dividend.userId, existing.id);
    return;
  }
  const fields = {
    accountId: dividend.accountId,
    date: dividend.paymentDate,
    amount: dividend.netAmount,
    currency: dividend.currency,
    description: `Dividendo ${symbol}`,
  };
  if (existing) {
    await r.cashMovements.update({ ...existing, ...fields });
  } else {
    await r.cashMovements.add({
      ...fields,
      userId: dividend.userId,
      type: 'DIVIDEND',
      source: 'AUTOMATIC',
      tradeId: null,
      dividendId: dividend.id,
      transferId: null,
    });
  }
}

export class Dividends {
  readonly #uow: UnitOfWork;

  constructor(deps: { uow: UnitOfWork }) {
    this.#uow = deps.uow;
  }

  list(userId: string, filter: DividendQuery & PageRequest): Promise<Page<DividendView>> {
    return this.#uow.read(async (r) => {
      const result = await r.dividends.search(userId, filter);
      return { items: await views(r, userId, result.items), total: result.total };
    });
  }

  get(userId: string, id: string): Promise<DividendView> {
    return this.#uow.read(async (r) => {
      const dividend = await r.dividends.findById(userId, id);
      if (!dividend) throw new NotFoundError('El dividendo');
      return (await views(r, userId, [dividend]))[0]!;
    });
  }

  create(userId: string, input: DividendInput): Promise<DividendView> {
    return this.#uow.transaction(async (r) => {
      const account = await lockAccount(r, userId, input.accountId);
      assertNotArchived(account);
      const instrument = await requireInstrument(r, input.instrumentId);
      const dividend = await r.dividends.add(await build(r, userId, account, instrument, input));
      await syncMovement(r, dividend, instrument.symbol);
      return (await views(r, userId, [dividend]))[0]!;
    });
  }

  replace(userId: string, id: string, input: DividendInput): Promise<DividendView> {
    return this.#uow.transaction(async (r) => {
      const current = await r.dividends.findById(userId, id);
      if (!current) throw new NotFoundError('El dividendo');
      const accounts = await lockAccounts(r, userId, [current.accountId, input.accountId]);
      const target = accounts.get(input.accountId)!;
      if (target.id !== current.accountId || (current.status === 'ANNOUNCED' && input.status === 'PAID')) {
        assertNotArchived(target);
      }
      const instrument = await requireInstrument(r, input.instrumentId);
      const updated: Dividend = { ...(await build(r, userId, target, instrument, input)), id };
      await r.dividends.update(updated);
      await syncMovement(r, updated, instrument.symbol);
      return (await views(r, userId, [updated]))[0]!;
    });
  }

  /** ANNOUNCED → PAID. Con `netAmount` se mantiene el bruto y se ajusta la retención. */
  markPaid(userId: string, id: string, input: { paymentDate?: string | undefined; netAmount?: Decimal | undefined }): Promise<DividendView> {
    return this.#uow.transaction(async (r) => {
      const current = await r.dividends.findById(userId, id);
      if (!current) throw new NotFoundError('El dividendo');
      if (current.status !== 'ANNOUNCED') throw new BusinessRuleError('INVALID_STATE', 'El dividendo ya está pagado');
      const account = await lockAccount(r, userId, current.accountId);
      assertNotArchived(account);
      const instrument = await requireInstrument(r, current.instrumentId);

      let updated: Dividend = { ...current, status: 'PAID', paymentDate: input.paymentDate ?? current.paymentDate };
      if (input.netAmount !== undefined) {
        try {
          const amounts = computeDividendAmounts({
            currency: current.currency,
            withholdingRate: current.withholdingRate,
            grossAmount: current.grossAmount,
            netAmount: input.netAmount,
          });
          updated = { ...updated, ...amounts };
        } catch (err) {
          if (err instanceof InvalidDividendAmountError) throw new ValidationError([{ field: 'netAmount', message: err.message }]);
          throw err;
        }
      }
      await r.dividends.update(updated);
      await syncMovement(r, updated, instrument.symbol);
      return (await views(r, userId, [updated]))[0]!;
    });
  }

  delete(userId: string, id: string): Promise<void> {
    return this.#uow.transaction(async (r) => {
      const current = await r.dividends.findById(userId, id);
      if (!current) throw new NotFoundError('El dividendo');
      await lockAccount(r, userId, current.accountId);
      const movement = await r.cashMovements.findByDividendId(userId, id);
      if (movement) await r.cashMovements.delete(userId, movement.id);
      await r.dividends.delete(userId, id);
    });
  }
}
