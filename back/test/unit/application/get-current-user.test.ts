import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Email } from '../../../src/domain/email.ts';
import type { User } from '../../../src/domain/user.ts';
import { UnauthenticatedError } from '../../../src/application/errors.ts';
import { GetCurrentUser } from '../../../src/application/use-cases/get-current-user.ts';
import {
  FixedClock,
  InMemorySessionRepository,
  InMemoryUserRepository,
  SequentialTokenGenerator,
} from '../../support/in-memory.ts';

const NOW = new Date('2026-10-03T12:00:00Z');

describe('GetCurrentUser', () => {
  let users: InMemoryUserRepository;
  let sessions: InMemorySessionRepository;
  let clock: FixedClock;
  let useCase: GetCurrentUser;
  let user: User;

  beforeEach(async () => {
    users = new InMemoryUserRepository();
    sessions = new InMemorySessionRepository();
    clock = new FixedClock(NOW);
    useCase = new GetCurrentUser({ users, sessions, tokens: new SequentialTokenGenerator(), clock });
    user = await users.add({ email: Email.create('ana@example.com'), passwordHash: 'x', createdAt: NOW, reportingCurrency: 'USD' });
    await sessions.add({
      tokenHash: 'sha:tok',
      userId: user.id,
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
  });

  test('sesión válida → devuelve el usuario', async () => {
    assert.equal((await useCase.execute('tok')).id, user.id);
  });

  test('sesión expirada → Unauthenticated y la sesión se elimina', async () => {
    clock.current = new Date(NOW.getTime() + 60_000);
    await assert.rejects(useCase.execute('tok'), UnauthenticatedError);
    assert.equal(sessions.sessions.size, 0);
  });

  test('token inexistente → Unauthenticated', async () => {
    await assert.rejects(useCase.execute('otro'), UnauthenticatedError);
  });

  test('token vacío → Unauthenticated', async () => {
    await assert.rejects(useCase.execute(''), UnauthenticatedError);
  });
});
