import type { EntityManager, Repository } from 'typeorm';
import type { Currency } from '../../domain/currency.ts';
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
        }),
      );
      return toDomain(record);
    } catch (err) {
      if (isUniqueViolation(err)) throw new EmailAlreadyRegisteredError();
      throw err;
    }
  }

  async updateReportingCurrency(id: string, currency: Currency): Promise<void> {
    await this.#repo.update({ id }, { reportingCurrency: currency });
  }
}
