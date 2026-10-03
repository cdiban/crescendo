import type { Currency } from './currency.ts';

export type Account = {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly broker: string;
  readonly baseCurrency: Currency;
  readonly archived: boolean;
};

export type NewAccount = Omit<Account, 'id'>;
