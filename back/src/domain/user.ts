import type { Currency } from './currency.ts';
import type { Email } from './email.ts';

export const DEFAULT_REPORTING_CURRENCY: Currency = 'USD';

export type User = {
  readonly id: string;
  readonly email: Email;
  readonly passwordHash: string;
  readonly createdAt: Date;
  /** Moneda en que se reportan los consolidados. */
  readonly reportingCurrency: Currency;
};

export type NewUser = Omit<User, 'id'>;
