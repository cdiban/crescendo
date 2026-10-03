import { Email } from '../../domain/email.ts';
import { InvalidCredentialsError } from '../errors.ts';
import type { Clock } from '../ports/clock.ts';
import type { PasswordHasher } from '../ports/password-hasher.ts';
import type { SessionRepository } from '../ports/session-repository.ts';
import type { TokenGenerator } from '../ports/token-generator.ts';
import type { UserRepository } from '../ports/user-repository.ts';

export type LoginDeps = {
  users: UserRepository;
  sessions: SessionRepository;
  hasher: PasswordHasher;
  tokens: TokenGenerator;
  clock: Clock;
  sessionTtlMs: number;
};

export type LoginInput = { email: string; password: string };
export type LoginResult = { token: string; expiresAt: Date };

export class Login {
  readonly #deps: LoginDeps;
  /** Se calcula al construir para que ni el primer intento revele nada por tiempo. */
  readonly #dummyHash: Promise<string>;

  constructor(deps: LoginDeps) {
    this.#deps = deps;
    this.#dummyHash = deps.hasher.hash('crescendo-dummy-password');
    this.#dummyHash.catch(() => {}); // si falla, se propaga en execute(), no como rechazo sin manejar
  }

  async execute(input: LoginInput): Promise<LoginResult> {
    const { users, sessions, hasher, tokens, clock, sessionTtlMs } = this.#deps;
    const user = await users.findByEmail(Email.create(input.email));
    // Si el email no existe se verifica igual contra un hash ficticio para que
    // el tiempo de respuesta no revele qué emails están registrados.
    const hash = user?.passwordHash ?? (await this.#dummyHash);
    const valid = await hasher.verify(input.password, hash);
    if (!user || !valid) throw new InvalidCredentialsError();

    const token = tokens.generate();
    const now = clock.now();
    const expiresAt = new Date(now.getTime() + sessionTtlMs);
    await sessions.add({ tokenHash: tokens.hash(token), userId: user.id, createdAt: now, expiresAt });
    return { token, expiresAt };
  }
}
