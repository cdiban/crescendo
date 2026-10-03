import { randomUUID } from 'node:crypto';
import type { Currency } from '../../src/domain/currency.ts';
import type { Email } from '../../src/domain/email.ts';
import type { Session } from '../../src/domain/session.ts';
import type { NewUser, User } from '../../src/domain/user.ts';
import type { Clock } from '../../src/application/ports/clock.ts';
import type { PasswordHasher } from '../../src/application/ports/password-hasher.ts';
import type { SessionRepository } from '../../src/application/ports/session-repository.ts';
import type { TokenGenerator } from '../../src/application/ports/token-generator.ts';
import type { UserRepository } from '../../src/application/ports/user-repository.ts';
import type { FxQuote } from '../../src/domain/fx.ts';
import type { FetchedFxQuote } from '../../src/application/ports/fx-rate-provider.ts';
import type { FxRateRepository, Repositories } from '../../src/application/ports/repositories.ts';
import type { UnitOfWork } from '../../src/application/ports/unit-of-work.ts';

export class InMemoryUserRepository implements UserRepository {
  readonly users = new Map<string, User>();

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async findByEmail(email: Email): Promise<User | null> {
    return [...this.users.values()].find((u) => u.email.equals(email)) ?? null;
  }

  async add(newUser: NewUser): Promise<User> {
    const user: User = { id: randomUUID(), ...newUser };
    this.users.set(user.id, user);
    return user;
  }

  async updateReportingCurrency(id: string, currency: Currency): Promise<void> {
    const user = this.users.get(id);
    if (user) this.users.set(id, { ...user, reportingCurrency: currency });
  }
}

export class InMemorySessionRepository implements SessionRepository {
  readonly sessions = new Map<string, Session>();

  async add(session: Session): Promise<void> {
    this.sessions.set(session.tokenHash, session);
  }

  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    return this.sessions.get(tokenHash) ?? null;
  }

  async delete(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }
}

/** Hasher reversible para tests: deja ver qué se verificó contra qué. */
export class FakePasswordHasher implements PasswordHasher {
  readonly verified: string[] = [];

  async hash(plain: string): Promise<string> {
    return `hashed:${plain}`;
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    this.verified.push(hash);
    return hash === `hashed:${plain}`;
  }
}

export class SequentialTokenGenerator implements TokenGenerator {
  #next = 0;

  generate(): string {
    this.#next += 1;
    return `token-${this.#next}`;
  }

  hash(token: string): string {
    return `sha:${token}`;
  }
}

export class FixedClock implements Clock {
  current: Date;

  constructor(current: Date) {
    this.current = current;
  }

  now(): Date {
    return new Date(this.current);
  }

  today(): string {
    return this.current.toISOString().slice(0, 10);
  }
}

export class InMemoryFxRateRepository implements FxRateRepository {
  readonly rows = new Map<string, FetchedFxQuote>();

  async upsert(quotes: readonly FetchedFxQuote[]): Promise<number> {
    let changed = 0;
    for (const q of quotes) {
      const key = `${q.currency}|${q.date}`;
      const current = this.rows.get(key);
      if (current && current.rate.eq(q.rate) && current.source === q.source) continue;
      this.rows.set(key, q);
      changed += 1;
    }
    return changed;
  }

  async listUpTo(date: string): Promise<FetchedFxQuote[]> {
    return [...this.rows.values()].filter((q) => q.date <= date).sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  async lastDateInYear(currency: FxQuote['currency'], year: number): Promise<string | null> {
    const dates = [...this.rows.values()].filter((q) => q.currency === currency && q.date.startsWith(`${year}-`)).map((q) => q.date).sort();
    return dates.at(-1) ?? null;
  }
}

/** UnitOfWork en memoria con sólo los repositorios que el test necesita. */
export function inMemoryUnitOfWork(repos: Partial<Repositories>): UnitOfWork {
  const all = repos as Repositories;
  return { transaction: (work) => work(all), read: (work) => work(all) };
}
