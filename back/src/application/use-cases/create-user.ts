import { Email } from '../../domain/email.ts';
import { DEFAULT_REPORTING_CURRENCY, type User } from '../../domain/user.ts';
import { EmailAlreadyRegisteredError, PasswordTooShortError } from '../errors.ts';
import type { Clock } from '../ports/clock.ts';
import type { PasswordHasher } from '../ports/password-hasher.ts';
import type { UserRepository } from '../ports/user-repository.ts';

export const MIN_PASSWORD_LENGTH = 12;

export type CreateUserDeps = {
  users: UserRepository;
  hasher: PasswordHasher;
  clock: Clock;
};

export type CreateUserInput = { email: string; password: string };

export class CreateUser {
  readonly #deps: CreateUserDeps;

  constructor(deps: CreateUserDeps) {
    this.#deps = deps;
  }

  async execute(input: CreateUserInput): Promise<User> {
    const { users, hasher, clock } = this.#deps;
    const email = Email.create(input.email);
    // Se cuentan puntos de código, no unidades UTF-16.
    if ([...input.password].length < MIN_PASSWORD_LENGTH) {
      throw new PasswordTooShortError(MIN_PASSWORD_LENGTH);
    }
    if (await users.findByEmail(email)) throw new EmailAlreadyRegisteredError();

    return users.add({
      email,
      passwordHash: await hasher.hash(input.password),
      createdAt: clock.now(),
      reportingCurrency: DEFAULT_REPORTING_CURRENCY,
    });
  }
}
