import type { Currency, Money } from '../../domain/currency.ts';
import type { Email } from '../../domain/email.ts';
import type { NewUser, User } from '../../domain/user.ts';

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: Email): Promise<User | null>;
  /** Lanza EmailAlreadyRegisteredError si el email ya existe. */
  add(user: NewUser): Promise<User>;
  updatePreferences(id: string, changes: { reportingCurrency?: Currency | undefined; monthlyIncomeGoal?: Money | null | undefined }): Promise<void>;
}
