import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ScryptPasswordHasher } from '../../../src/infrastructure/security/scrypt-password-hasher.ts';

describe('ScryptPasswordHasher', () => {
  const hasher = new ScryptPasswordHasher();

  test('el hash no contiene la contraseña y usa salt aleatorio', async () => {
    const a = await hasher.hash('una-contraseña-larga');
    const b = await hasher.hash('una-contraseña-larga');
    assert.ok(!a.includes('una-contraseña-larga'));
    assert.notEqual(a, b);
  });

  test('verify acepta la contraseña correcta', async () => {
    const hash = await hasher.hash('una-contraseña-larga');
    assert.equal(await hasher.verify('una-contraseña-larga', hash), true);
  });

  test('verify rechaza una contraseña incorrecta', async () => {
    const hash = await hasher.hash('una-contraseña-larga');
    assert.equal(await hasher.verify('otra-contraseña', hash), false);
  });

  test('verify rechaza un hash mal formado sin lanzar', async () => {
    assert.equal(await hasher.verify('x', 'no-es-un-hash'), false);
  });
});
