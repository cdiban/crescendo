import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CryptoTokenGenerator } from '../../../src/infrastructure/security/crypto-token-generator.ts';

describe('CryptoTokenGenerator', () => {
  const tokens = new CryptoTokenGenerator();

  test('genera 32 bytes aleatorios en base64url', () => {
    const token = tokens.generate();
    assert.equal(Buffer.from(token, 'base64url').length, 32);
    assert.notEqual(token, tokens.generate());
  });

  test('hash es SHA-256 hex del token', () => {
    assert.equal(tokens.hash('abc'), createHash('sha256').update('abc').digest('hex'));
  });
});
