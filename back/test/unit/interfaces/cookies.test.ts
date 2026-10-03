import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readCookie, serializeCookie } from '../../../src/interfaces/http/cookies.ts';

describe('cookies', () => {
  test('readCookie encuentra la cookie por nombre', () => {
    assert.equal(readCookie('a=1; crescendo_session=abc_-123; b=2', 'crescendo_session'), 'abc_-123');
    assert.equal(readCookie('a=1', 'crescendo_session'), undefined);
    assert.equal(readCookie(undefined, 'crescendo_session'), undefined);
  });

  test('serializeCookie con Secure', () => {
    assert.equal(
      serializeCookie('crescendo_session', 'tok', { maxAgeSeconds: 604800, secure: true }),
      'crescendo_session=tok; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800',
    );
  });

  test('serializeCookie sin Secure', () => {
    assert.equal(
      serializeCookie('crescendo_session', '', { maxAgeSeconds: 0, secure: false }),
      'crescendo_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
    );
  });
});
