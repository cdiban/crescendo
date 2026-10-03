import {
  type ImportRole,
  isManualMovementType,
  signedManualAmount,
  type CashMovement,
  type ManualMovementType,
  type MovementSource,
} from '../../domain/cash-movement.ts';
import type { Currency } from '../../domain/currency.ts';
import { Decimal } from '../../domain/decimal.ts';
import { BusinessRuleError } from '../../domain/errors.ts';
import { NotFoundError } from '../errors.ts';
import type { IdGenerator } from '../ports/id-generator.ts';
import type { Page } from '../ports/page.ts';
import type { CashMovementFilter } from '../ports/repositories.ts';
import type { UnitOfWork } from '../ports/unit-of-work.ts';
import { assertNotArchived, failIf, lockAccount, lockAccounts } from './shared.ts';

export type CashMovementInput = {
  accountId: string;
  date: string;
  type: ManualMovementType;
  amount: Decimal;
  currency: Currency;
  description: string | null;
};

export type CashTransferInput = {
  date: string;
  fromAccountId: string;
  fromAmount: Decimal;
  fromCurrency: Currency;
  toAccountId: string;
  toAmount: Decimal;
  toCurrency: Currency;
  description: string | null;
};

export type CashTransferView = { id: string; date: string; out: CashMovement; in: CashMovement; rate: Decimal };

const RATE_SCALE = 10;

export class Cash {
  readonly #uow: UnitOfWork;
  readonly #ids: IdGenerator;

  constructor(deps: { uow: UnitOfWork; ids: IdGenerator }) {
    this.#uow = deps.uow;
    this.#ids = deps.ids;
  }

  list(userId: string, filter: CashMovementFilter): Promise<Page<CashMovement>> {
    return this.#uow.read((r) => r.cashMovements.search(userId, filter));
  }

  /** Movimiento manual. `source` IMPORT (con su `importRole`) sólo lo usa la importación inicial. */
  create(
    userId: string,
    input: CashMovementInput,
    source: Exclude<MovementSource, 'AUTOMATIC'> = 'MANUAL',
    importRole: ImportRole | null = null,
  ): Promise<CashMovement> {
    return this.#uow.transaction(async (r) => {
      const account = await lockAccount(r, userId, input.accountId);
      assertNotArchived(account);
      failIf([
        input.type === 'ADJUSTMENT'
          ? input.amount.isZero() && { field: 'amount', message: 'No puede ser 0' }
          : !input.amount.isPositive() && { field: 'amount', message: 'Debe ser mayor que 0 (el tipo define el signo)' },
      ]);
      return r.cashMovements.add({
        userId,
        accountId: account.id,
        date: input.date,
        type: input.type,
        amount: signedManualAmount(input.type, input.amount),
        currency: input.currency,
        description: input.description,
        source,
        importRole: source === 'IMPORT' ? importRole : null,
        tradeId: null,
        dividendId: null,
        transferId: null,
      });
    });
  }

  delete(userId: string, id: string): Promise<void> {
    return this.#uow.transaction(async (r) => {
      const movement = await r.cashMovements.findById(userId, id);
      if (!movement) throw new NotFoundError('El movimiento');
      if (!isManualMovementType(movement.type)) {
        throw new BusinessRuleError(
          'AUTOMATIC_MOVEMENT',
          'Es un movimiento automático: se elimina borrando su operación, dividendo o transferencia',
        );
      }
      await lockAccount(r, userId, movement.accountId);
      await r.cashMovements.delete(userId, id);
    });
  }

  /** Transferencia entre cuentas propias y/o conversión de moneda: dos patas enlazadas. */
  transfer(userId: string, input: CashTransferInput): Promise<CashTransferView> {
    return this.#uow.transaction(async (r) => {
      const accounts = await lockAccounts(r, userId, [input.fromAccountId, input.toAccountId]);
      for (const account of accounts.values()) assertNotArchived(account);
      failIf([
        !input.fromAmount.isPositive() && { field: 'fromAmount', message: 'Debe ser mayor que 0' },
        !input.toAmount.isPositive() && { field: 'toAmount', message: 'Debe ser mayor que 0' },
      ]);
      const sameCurrency = input.fromCurrency === input.toCurrency;
      if (sameCurrency && input.fromAccountId === input.toAccountId) {
        throw new BusinessRuleError('CURRENCY_MISMATCH', 'Una conversión en la misma cuenta requiere monedas distintas');
      }
      if (sameCurrency && !input.fromAmount.eq(input.toAmount)) {
        throw new BusinessRuleError('CURRENCY_MISMATCH', 'En la misma moneda el monto de origen y destino deben ser iguales');
      }

      const transferId = this.#ids.newId();
      const common = { userId, date: input.date, description: input.description, source: 'AUTOMATIC' as const, importRole: null, tradeId: null, dividendId: null, transferId };
      const out = await r.cashMovements.add({
        ...common,
        accountId: input.fromAccountId,
        type: 'TRANSFER_OUT',
        amount: input.fromAmount.neg(),
        currency: input.fromCurrency,
      });
      const inLeg = await r.cashMovements.add({
        ...common,
        accountId: input.toAccountId,
        type: 'TRANSFER_IN',
        amount: input.toAmount,
        currency: input.toCurrency,
      });
      const rate = sameCurrency ? Decimal.ONE : input.toAmount.div(input.fromAmount, RATE_SCALE);
      return { id: transferId, date: input.date, out, in: inLeg, rate };
    });
  }

  deleteTransfer(userId: string, transferId: string): Promise<void> {
    return this.#uow.transaction(async (r) => {
      const legs = await r.cashMovements.listByTransferId(userId, transferId);
      if (legs.length === 0) throw new NotFoundError('La transferencia');
      await lockAccounts(r, userId, legs.map((l) => l.accountId));
      for (const leg of legs) await r.cashMovements.delete(userId, leg.id);
    });
  }
}
