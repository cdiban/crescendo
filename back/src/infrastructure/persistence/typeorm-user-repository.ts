import type { EntityManager, Repository } from 'typeorm';
import type { Currency, Money } from '../../domain/currency.ts';
import { Decimal } from '../../domain/decimal.ts';
import { Email } from '../../domain/email.ts';
import type { NewUser, User } from '../../domain/user.ts';
import { EmailAlreadyRegisteredError } from '../../application/errors.ts';
import type { UserRepository } from '../../application/ports/user-repository.ts';
import { isUniqueViolation } from './errors.ts';
import { UserSchema, type UserRecord } from './schemas.ts';

function toDomain(record: UserRecord): User {
  return {
    id: record.id,
    email: Email.create(record.email),
    passwordHash: record.passwordHash,
    createdAt: record.createdAt,
    // El CHECK de la BD garantiza CLP | USD | EUR.
    reportingCurrency: record.reportingCurrency as Currency,
    monthlyIncomeGoal:
      record.monthlyIncomeGoalAmount === null
        ? null
        : { amount: Decimal.parse(record.monthlyIncomeGoalAmount), currency: record.monthlyIncomeGoalCurrency!.trim() as Currency },
  };
}

export class TypeOrmUserRepository implements UserRepository {
  readonly #repo: Repository<UserRecord>;

  constructor(manager: EntityManager) {
    this.#repo = manager.getRepository(UserSchema);
  }

  async findById(id: string): Promise<User | null> {
    const record = await this.#repo.findOneBy({ id });
    return record ? toDomain(record) : null;
  }

  async findByEmail(email: Email): Promise<User | null> {
    const record = await this.#repo.findOneBy({ email: email.value });
    return record ? toDomain(record) : null;
  }

  async add(user: NewUser): Promise<User> {
    try {
      const record = await this.#repo.save(
        this.#repo.create({
          email: user.email.value,
          passwordHash: user.passwordHash,
          createdAt: user.createdAt,
          reportingCurrency: user.reportingCurrency,
          monthlyIncomeGoalAmount: user.monthlyIncomeGoal?.amount.toString() ?? null,
          monthlyIncomeGoalCurrency: user.monthlyIncomeGoal?.currency ?? null,
        }),
      );
      return toDomain(record);
    } catch (err) {
      if (isUniqueViolation(err)) throw new EmailAlreadyRegisteredError();
      throw err;
    }
  }

  async updatePreferences(id: string, changes: { reportingCurrency?: Currency | undefined; monthlyIncomeGoal?: Money | null | undefined }): Promise<void> {
    const fields: Partial<UserRecord> = {};
    if (changes.reportingCurrency) fields.reportingCurrency = changes.reportingCurrency;
    if (changes.monthlyIncomeGoal !== undefined) {
      fields.monthlyIncomeGoalAmount = changes.monthlyIncomeGoal?.amount.toString() ?? null;
      fields.monthlyIncomeGoalCurrency = changes.monthlyIncomeGoal?.currency ?? null;
    }
    if (Object.keys(fields).length > 0) await this.#repo.update({ id }, fields);
  }
}
