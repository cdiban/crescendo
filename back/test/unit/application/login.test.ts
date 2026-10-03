import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Email } from '../../../src/domain/email.ts';
import { InvalidCredentialsError } from '../../../src/application/errors.ts';
import { Login } from '../../../src/application/use-cases/login.ts';
import {
  FakePasswordHasher,
  FixedClock,
  InMemorySessionRepository,
  InMemoryUserRepository,
  SequentialTokenGenerator,
} from '../../support/in-memory.ts';

const NOW = new Date('2026-10-03T12:00:00Z');
const TTL_MS = 168 * 3_600_000;

describe('Login', () => {
  let users: InMemoryUserRepository;
  let sessions: InMemorySessionRepository;
  let hasher: FakePasswordHasher;
  let login: Login;

  beforeEach(async () => {
    users = new InMemoryUserRepository();
    sessions = new InMemorySessionRepository();
    hasher = new FakePasswordHasher();
    login = new Login({
      users,
      sessions,
      hasher,
      tokens: new SequentialTokenGenerator(),
      clock: new FixedClock(NOW),
      sessionTtlMs: TTL_MS,
    });
    await users.add({
      email: Email.create('ana@example.com'),
      passwordHash: await hasher.hash('correcta-y-larga'),
      createdAt: NOW,
    });
  });

  test('con credenciales válidas crea una sesión y devuelve el token en claro', async () => {
    const result = await login.execute({ email: 'ANA@example.com', password: 'correcta-y-larga' });

    assert.equal(result.token, 'token-1');
    assert.deepEqual(result.expiresAt, new Date(NOW.getTime() + TTL_MS));
    const stored = [...sessions.sessions.values()];
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.tokenHash, 'sha:token-1', 'en el repositorio sólo se guarda el hash');
    assert.equal(stored[0]?.userId, [...users.users.values()][0]?.id);
    assert.deepEqual(stored[0]?.createdAt, NOW);
  });

  test('email inexistente → InvalidCredentials, verificando igual contra un hash (tiempo similar)', async () => {
    await assert.rejects(
      login.execute({ email: 'nadie@example.com', password: 'lo-que-sea-123' }),
      InvalidCredentialsError,
    );
    assert.equal(hasher.verified.length, 1);
    assert.equal(sessions.sessions.size, 0);
  });

  test('contraseña errónea → InvalidCredentials', async () => {
    await assert.rejects(
      login.execute({ email: 'ana@example.com', password: 'incorrecta-123' }),
      InvalidCredentialsError,
    );
    assert.equal(sessions.sessions.size, 0);
  });

  test('ambos fallos producen el mismo error', async () => {
    const a = await login.execute({ email: 'nadie@example.com', password: 'x' }).catch((e: unknown) => e);
    const b = await login.execute({ email: 'ana@example.com', password: 'x' }).catch((e: unknown) => e);
    assert.ok(a instanceof InvalidCredentialsError && b instanceof InvalidCredentialsError);
    assert.equal(a.message, b.message);
  });
});
