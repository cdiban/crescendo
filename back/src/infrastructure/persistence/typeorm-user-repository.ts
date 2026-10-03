import type { DataSource, Repository } from 'typeorm';
import { Email } from '../../domain/email.ts';
import type { NewUser, User } from '../../domain/user.ts';
import { EmailAlreadyRegisteredError } from '../../application/errors.ts';
import type { UserRepository } from '../../application/ports/user-repository.ts';
import { UserSchema, type UserRecord } from './schemas.ts';

const UNIQUE_VIOLATION = '23505';

function toDomain(record: UserRecord): User {
  return { id: record.id, email: Email.create(record.email), passwordHash: record.passwordHash, createdAt: record.createdAt };
}

export class TypeOrmUserRepository implements UserRepository {
  readonly #repo: Repository<UserRecord>;

  constructor(dataSource: DataSource) {
    this.#repo = dataSource.getRepository(UserSchema);
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
        this.#repo.create({ email: user.email.value, passwordHash: user.passwordHash, createdAt: user.createdAt }),
      );
      return toDomain(record);
    } catch (err) {
      const code = (err as { driverError?: { code?: string } }).driverError?.code;
      if (code === UNIQUE_VIOLATION) throw new EmailAlreadyRegisteredError();
      throw err;
    }
  }
}
