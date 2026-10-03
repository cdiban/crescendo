import type { Account } from '../../domain/account.ts';
import type { Currency } from '../../domain/currency.ts';
import { Decimal } from '../../domain/decimal.ts';
import { NotFoundError } from '../errors.ts';
import type { CashBalance, Repositories } from '../ports/repositories.ts';
import type { UnitOfWork } from '../ports/unit-of-work.ts';
import { lockAccount } from './shared.ts';

export type Money = { amount: Decimal; currency: Currency };
export type AccountView = Account & { cashBalances: Money[] };

export type AccountChanges = Partial<Pick<Account, 'name' | 'broker' | 'archived'>>;

/** Un saldo por moneda con movimientos; la base siempre (aunque sea 0) y primero. */
function withBalances(account: Account, balances: CashBalance[]): AccountView {
  const own = balances.filter((b) => b.accountId === account.id);
  const base = own.find((b) => b.currency === account.baseCurrency)?.amount ?? Decimal.ZERO;
  const others = own.filter((b) => b.currency !== account.baseCurrency).sort((a, b) => (a.currency < b.currency ? -1 : 1));
  return {
    ...account,
    cashBalances: [{ amount: base, currency: account.baseCurrency }, ...others.map(({ amount, currency }) => ({ amount, currency }))],
  };
}

async function view(r: Repositories, account: Account): Promise<AccountView> {
  return withBalances(account, await r.cashMovements.balances(account.userId, account.id));
}

export class Accounts {
  readonly #uow: UnitOfWork;

  constructor(deps: { uow: UnitOfWork }) {
    this.#uow = deps.uow;
  }

  list(userId: string): Promise<AccountView[]> {
    return this.#uow.read(async (r) => {
      const [accounts, balances] = await Promise.all([r.accounts.listByUser(userId), r.cashMovements.balances(userId)]);
      return accounts.map((a) => withBalances(a, balances));
    });
  }

  get(userId: string, id: string): Promise<AccountView> {
    return this.#uow.read(async (r) => {
      const account = await r.accounts.findById(userId, id);
      if (!account) throw new NotFoundError('La cuenta');
      return view(r, account);
    });
  }

  create(userId: string, input: { name: string; broker: string; baseCurrency: Currency }): Promise<AccountView> {
    return this.#uow.transaction(async (r) => {
      const account = await r.accounts.add({
        userId,
        name: input.name.trim(),
        broker: input.broker.trim(),
        baseCurrency: input.baseCurrency,
        archived: false,
      });
      return view(r, account);
    });
  }

  update(userId: string, id: string, changes: AccountChanges): Promise<AccountView> {
    return this.#uow.transaction(async (r) => {
      const current = await lockAccount(r, userId, id);
      const updated: Account = {
        ...current,
        ...(changes.name !== undefined ? { name: changes.name.trim() } : {}),
        ...(changes.broker !== undefined ? { broker: changes.broker.trim() } : {}),
        ...(changes.archived !== undefined ? { archived: changes.archived } : {}),
      };
      await r.accounts.update(updated);
      return view(r, updated);
    });
  }
}
