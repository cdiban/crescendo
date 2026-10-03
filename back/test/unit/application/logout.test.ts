import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { UnauthenticatedError } from '../../../src/application/errors.ts';
import { Logout } from '../../../src/application/use-cases/logout.ts';
import { FixedClock, InMemorySessionRepository, SequentialTokenGenerator } from '../../support/in-memory.ts';

const NOW = new Date('2026-10-03T12:00:00Z');

describe('Logout', () => {
  let sessions: InMemorySessionRepository;
  let clock: FixedClock;
  let logout: Logout;

  beforeEach(async () => {
    sessions = new InMemorySessionRepository();
    clock = new FixedClock(NOW);
    logout = new Logout({ sessions, tokens: new SequentialTokenGenerator(), clock });
    await sessions.add({ tokenHash: 'sha:tok', userId: 'u', createdAt: NOW, expiresAt: new Date(NOW.getTime() + 60_000) });
    await sessions.add({ tokenHash: 'sha:otro', userId: 'u', createdAt: NOW, expiresAt: new Date(NOW.getTime() + 60_000) });
  });

  test('elimina sólo la sesión del token', async () => {
    await logout.execute('tok');
    assert.deepEqual([...sessions.sessions.keys()], ['sha:otro']);
  });

  test('token inexistente → Unauthenticated', async () => {
    await assert.rejects(logout.execute('nada'), UnauthenticatedError);
  });

  test('sesión expirada → Unauthenticated y se elimina igual', async () => {
    clock.current = new Date(NOW.getTime() + 60_000);
    await assert.rejects(logout.execute('tok'), UnauthenticatedError);
    assert.equal(sessions.sessions.has('sha:tok'), false);
  });
});
