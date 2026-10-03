import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../src/domain/decimal.ts';
import { Email } from '../../src/domain/email.ts';
import { EmailAlreadyRegisteredError } from '../../src/application/errors.ts';
import type { Container } from '../../src/composition.ts';
import { resetDatabase, startTestContainer } from '../support/test-database.ts';

const NOW = new Date('2026-10-03T12:00:00.000Z');
const HASH = 'a'.repeat(64);

describe('repositorios TypeORM (Postgres real)', () => {
  let container: Container;

  before(async () => {
    container = await startTestContainer();
  });
  after(() => container.stop());
  beforeEach(() => resetDatabase(container));

  test('UserRepository: add + findByEmail + findById', async () => {
    const { users } = container.repositories;
    const created = await users.add({ email: Email.create('ana@example.com'), passwordHash: 'scrypt$x', createdAt: NOW, reportingCurrency: 'USD', monthlyIncomeGoal: null, dividendCutThreshold: Decimal.parse('0.1') });

    assert.match(created.id, /^[0-9a-f-]{36}$/);
    const byEmail = await users.findByEmail(Email.create('ANA@example.com'));
    assert.equal(byEmail?.id, created.id);
    assert.equal(byEmail?.email.value, 'ana@example.com');
    assert.equal(byEmail?.passwordHash, 'scrypt$x');
    assert.deepEqual(byEmail?.createdAt, NOW);
    assert.equal((await users.findById(created.id))?.id, created.id);
    assert.equal(await users.findById('00000000-0000-0000-0000-000000000000'), null);
    assert.equal(await users.findByEmail(Email.create('otro@example.com')), null);
  });

  test('UserRepository: email duplicado → EmailAlreadyRegistered (constraint UNIQUE)', async () => {
    const { users } = container.repositories;
    await users.add({ email: Email.create('ana@example.com'), passwordHash: 'x', createdAt: NOW, reportingCurrency: 'USD', monthlyIncomeGoal: null, dividendCutThreshold: Decimal.parse('0.1') });
    await assert.rejects(
      users.add({ email: Email.create('ana@example.com'), passwordHash: 'y', createdAt: NOW, reportingCurrency: 'USD', monthlyIncomeGoal: null, dividendCutThreshold: Decimal.parse('0.1') }),
      EmailAlreadyRegisteredError,
    );
  });

  test('la BD rechaza emails no normalizados', async () => {
    await assert.rejects(
      container.dataSource.query(`INSERT INTO users (email, password_hash) VALUES ('Ana@Example.com', 'x')`),
    );
  });

  test('SessionRepository: add + findByTokenHash + delete', async () => {
    const { users, sessions } = container.repositories;
    const user = await users.add({ email: Email.create('ana@example.com'), passwordHash: 'x', createdAt: NOW, reportingCurrency: 'USD', monthlyIncomeGoal: null, dividendCutThreshold: Decimal.parse('0.1') });
    const session = { tokenHash: HASH, userId: user.id, createdAt: NOW, expiresAt: new Date('2026-10-10T12:00:00Z') };

    await sessions.add(session);
    assert.deepEqual(await sessions.findByTokenHash(HASH), session);
    await sessions.delete(HASH);
    assert.equal(await sessions.findByTokenHash(HASH), null);
  });

  test('la BD sólo acepta hashes SHA-256 como token_hash (nunca el token en claro)', async () => {
    const { users, sessions } = container.repositories;
    const user = await users.add({ email: Email.create('ana@example.com'), passwordHash: 'x', createdAt: NOW, reportingCurrency: 'USD', monthlyIncomeGoal: null, dividendCutThreshold: Decimal.parse('0.1') });
    await assert.rejects(sessions.add({ tokenHash: 'token-en-claro', userId: user.id, createdAt: NOW, expiresAt: NOW }));
  });

  test('borrar el usuario borra sus sesiones (ON DELETE CASCADE)', async () => {
    const { users, sessions } = container.repositories;
    const user = await users.add({ email: Email.create('ana@example.com'), passwordHash: 'x', createdAt: NOW, reportingCurrency: 'USD', monthlyIncomeGoal: null, dividendCutThreshold: Decimal.parse('0.1') });
    await sessions.add({ tokenHash: HASH, userId: user.id, createdAt: NOW, expiresAt: NOW });
    await container.dataSource.query('DELETE FROM users WHERE id = $1', [user.id]);
    assert.equal(await sessions.findByTokenHash(HASH), null);
  });

  test('migraciones: tablas e índice creados, sin migraciones pendientes', async () => {
    assert.equal(await container.dataSource.showMigrations(), false);
    const indexes = await container.dataSource.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'sessions' AND indexdef LIKE '%(user_id)%'`,
    );
    assert.equal(indexes.length, 1);
  });
});
