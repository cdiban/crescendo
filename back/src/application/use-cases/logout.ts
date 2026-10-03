import { isSessionExpired } from '../../domain/session.ts';
import { UnauthenticatedError } from '../errors.ts';
import type { Clock } from '../ports/clock.ts';
import type { SessionRepository } from '../ports/session-repository.ts';
import type { TokenGenerator } from '../ports/token-generator.ts';

export type LogoutDeps = {
  sessions: SessionRepository;
  tokens: TokenGenerator;
  clock: Clock;
};

export class Logout {
  readonly #deps: LogoutDeps;

  constructor(deps: LogoutDeps) {
    this.#deps = deps;
  }

  async execute(token: string): Promise<void> {
    const { sessions, tokens, clock } = this.#deps;
    if (!token) throw new UnauthenticatedError();

    const tokenHash = tokens.hash(token);
    const session = await sessions.findByTokenHash(tokenHash);
    if (!session) throw new UnauthenticatedError();

    await sessions.delete(tokenHash);
    if (isSessionExpired(session, clock.now())) throw new UnauthenticatedError();
  }
}
