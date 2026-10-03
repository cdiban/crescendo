import type { Currency, Money } from '../../domain/currency.ts';
import { NotFoundError, ValidationError } from '../errors.ts';
import type { UnitOfWork } from '../ports/unit-of-work.ts';

export type PreferencesView = { reportingCurrency: Currency; monthlyIncomeGoal: Money | null };

export class Preferences {
  readonly #uow: UnitOfWork;

  constructor(deps: { uow: UnitOfWork }) {
    this.#uow = deps.uow;
  }

  get(userId: string): Promise<PreferencesView> {
    return this.#uow.read(async (r) => {
      const user = await r.users.findById(userId);
      if (!user) throw new NotFoundError('El usuario');
      return { reportingCurrency: user.reportingCurrency, monthlyIncomeGoal: user.monthlyIncomeGoal };
    });
  }

  update(userId: string, changes: { reportingCurrency?: Currency | undefined; monthlyIncomeGoal?: Money | null | undefined }): Promise<PreferencesView> {
    return this.#uow.transaction(async (r) => {
      if (changes.monthlyIncomeGoal && !changes.monthlyIncomeGoal.amount.isPositive()) {
        throw new ValidationError([{ field: 'monthlyIncomeGoal.amount', message: 'Debe ser mayor que 0' }]);
      }
      await r.users.updatePreferences(userId, changes);
      const user = await r.users.findById(userId);
      if (!user) throw new NotFoundError('El usuario');
      return { reportingCurrency: user.reportingCurrency, monthlyIncomeGoal: user.monthlyIncomeGoal };
    });
  }
}
