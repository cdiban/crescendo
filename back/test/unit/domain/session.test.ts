import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { isSessionExpired, type Session } from '../../../src/domain/session.ts';

const session: Session = {
  tokenHash: 'h',
  userId: 'u',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  expiresAt: new Date('2026-01-08T00:00:00Z'),
};

describe('Session', () => {
  test('vigente antes de expiresAt', () => {
    assert.equal(isSessionExpired(session, new Date('2026-01-07T23:59:59Z')), false);
  });

  test('expirada en expiresAt o después', () => {
    assert.equal(isSessionExpired(session, new Date('2026-01-08T00:00:00Z')), true);
    assert.equal(isSessionExpired(session, new Date('2026-02-01T00:00:00Z')), true);
  });
});
