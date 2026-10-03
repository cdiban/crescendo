import { isSessionExpired } from '../../domain/session.ts';
import type { User } from '../../domain/user.ts';
import { UnauthenticatedError } from '../errors.ts';
import type { Clock } from '../ports/clock.ts';
import type { SessionRepository } from '../ports/session-repository.ts';
import type { TokenGenerator } from '../ports/token-generator.ts';
import type { UserRepository } from '../ports/user-repository.ts';

export type GetCurrentUserDeps = {
  users: UserRepository;
  sessions: SessionRepository;
  tokens: TokenGenerator;
  clock: Clock;
};

export class GetCurrentUser {
  readonly #deps: GetCurrentUserDeps;

  constructor(deps: GetCurrentUserDeps) {
    this.#deps = deps;
  }

  async execute(token: string): Promise<User> {
    const { users, sessions, tokens, clock } = this.#deps;
    if (!token) throw new UnauthenticatedError();

    const tokenHash = tokens.hash(token);
    const session = await sessions.findByTokenHash(tokenHash);
    if (!session) throw new UnauthenticatedError();
    if (isSessionExpired(session, clock.now())) {
      await sessions.delete(tokenHash);
      throw new UnauthenticatedError();
    }

    const user = await users.findById(session.userId);
    if (!user) throw new UnauthenticatedError();
    return user;
  }
}
