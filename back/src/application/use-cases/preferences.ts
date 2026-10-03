import type { Currency } from '../../domain/currency.ts';
import { NotFoundError } from '../errors.ts';
import type { UnitOfWork } from '../ports/unit-of-work.ts';

export type PreferencesView = { reportingCurrency: Currency };

export class Preferences {
  readonly #uow: UnitOfWork;

  constructor(deps: { uow: UnitOfWork }) {
    this.#uow = deps.uow;
  }

  get(userId: string): Promise<PreferencesView> {
    return this.#uow.read(async (r) => {
      const user = await r.users.findById(userId);
      if (!user) throw new NotFoundError('El usuario');
      return { reportingCurrency: user.reportingCurrency };
    });
  }

  update(userId: string, changes: { reportingCurrency?: Currency | undefined }): Promise<PreferencesView> {
    return this.#uow.transaction(async (r) => {
      if (changes.reportingCurrency) await r.users.updateReportingCurrency(userId, changes.reportingCurrency);
      const user = await r.users.findById(userId);
      if (!user) throw new NotFoundError('El usuario');
      return { reportingCurrency: user.reportingCurrency };
    });
  }
}
