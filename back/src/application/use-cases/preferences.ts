import type { Currency, Money } from '../../domain/currency.ts';
import { Decimal } from '../../domain/decimal.ts';
import type { User } from '../../domain/user.ts';
import type { PreferenceChanges } from '../ports/user-repository.ts';
import { NotFoundError, ValidationError } from '../errors.ts';
import type { UnitOfWork } from '../ports/unit-of-work.ts';

export type PreferencesView = { reportingCurrency: Currency; monthlyIncomeGoal: Money | null; dividendCutThreshold: Decimal };

const view = (u: User): PreferencesView => ({ reportingCurrency: u.reportingCurrency, monthlyIncomeGoal: u.monthlyIncomeGoal, dividendCutThreshold: u.dividendCutThreshold });

export class Preferences {
  readonly #uow: UnitOfWork;

  constructor(deps: { uow: UnitOfWork }) {
    this.#uow = deps.uow;
  }

  get(userId: string): Promise<PreferencesView> {
    return this.#uow.read(async (r) => {
      const user = await r.users.findById(userId);
      if (!user) throw new NotFoundError('El usuario');
      return view(user);
    });
  }

  update(userId: string, changes: PreferenceChanges): Promise<PreferencesView> {
    return this.#uow.transaction(async (r) => {
      if (changes.monthlyIncomeGoal && !changes.monthlyIncomeGoal.amount.isPositive()) {
        throw new ValidationError([{ field: 'monthlyIncomeGoal.amount', message: 'Debe ser mayor que 0' }]);
      }
      const t = changes.dividendCutThreshold;
      if (t && (!t.isPositive() || t.gte(Decimal.ONE))) {
        throw new ValidationError([{ field: 'dividendCutThreshold', message: 'Debe ser una fracción mayor que 0 y menor que 1' }]);
      }
      await r.users.updatePreferences(userId, changes);
      const user = await r.users.findById(userId);
      if (!user) throw new NotFoundError('El usuario');
      return view(user);
    });
  }
}
