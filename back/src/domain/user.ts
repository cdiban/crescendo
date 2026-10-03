import type { Currency, Money } from './currency.ts';
import { Decimal } from './decimal.ts';
import type { Email } from './email.ts';

export const DEFAULT_REPORTING_CURRENCY: Currency = 'USD';
export const DEFAULT_DIVIDEND_CUT_THRESHOLD = Decimal.parse('0.10');

export type User = {
  readonly id: string;
  readonly email: Email;
  readonly passwordHash: string;
  readonly createdAt: Date;
  /** Moneda en que se reportan los consolidados. */
  readonly reportingCurrency: Currency;
  /** P2: gasto mensual objetivo a cubrir con dividendos; null = sin meta. */
  readonly monthlyIncomeGoal: Money | null;
  /** P4: caída del dividendo que se considera recorte (fracción 0–1). */
  readonly dividendCutThreshold: Decimal;
};

export type NewUser = Omit<User, 'id'>;
