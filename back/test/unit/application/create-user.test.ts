import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { InvalidEmailError } from '../../../src/domain/errors.ts';
import { EmailAlreadyRegisteredError, PasswordTooShortError } from '../../../src/application/errors.ts';
import { CreateUser } from '../../../src/application/use-cases/create-user.ts';
import { FakePasswordHasher, FixedClock, InMemoryUserRepository } from '../../support/in-memory.ts';

const NOW = new Date('2026-10-03T12:00:00Z');

describe('CreateUser', () => {
  let users: InMemoryUserRepository;
  let createUser: CreateUser;

  beforeEach(() => {
    users = new InMemoryUserRepository();
    createUser = new CreateUser({ users, hasher: new FakePasswordHasher(), clock: new FixedClock(NOW) });
  });

  test('crea el usuario con email normalizado y contraseña hasheada', async () => {
    const user = await createUser.execute({ email: ' Ana@Example.com ', password: '123456789012' });

    assert.equal(user.email.value, 'ana@example.com');
    assert.equal(user.passwordHash, 'hashed:123456789012');
    assert.deepEqual(user.createdAt, NOW);
    assert.equal(users.users.size, 1);
  });

  test('email duplicado (sin importar mayúsculas) → EmailAlreadyRegistered', async () => {
    await createUser.execute({ email: 'ana@example.com', password: '123456789012' });
    await assert.rejects(
      createUser.execute({ email: 'ANA@example.com', password: '123456789012' }),
      EmailAlreadyRegisteredError,
    );
    assert.equal(users.users.size, 1);
  });

  test('contraseña de menos de 12 caracteres → PasswordTooShort', async () => {
    await assert.rejects(createUser.execute({ email: 'ana@example.com', password: '12345678901' }), PasswordTooShortError);
    assert.equal(users.users.size, 0);
  });

  test('email inválido → InvalidEmail', async () => {
    await assert.rejects(createUser.execute({ email: 'no-es-email', password: '123456789012' }), InvalidEmailError);
  });
});
