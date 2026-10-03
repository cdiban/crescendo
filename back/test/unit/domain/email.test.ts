import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Email } from '../../../src/domain/email.ts';
import { InvalidEmailError } from '../../../src/domain/errors.ts';

describe('Email', () => {
  test('normaliza a minúsculas y recorta espacios', () => {
    assert.equal(Email.create('  Ana.Perez@Example.COM ').value, 'ana.perez@example.com');
  });

  test('dos emails con distinta capitalización son iguales', () => {
    assert.ok(Email.create('A@B.cl').equals(Email.create('a@b.cl')));
  });

  for (const raw of ['', '   ', 'sin-arroba', '@dominio.cl', 'usuario@', 'a b@c.cl', 'a@b', 'a@@b.cl']) {
    test(`rechaza ${JSON.stringify(raw)}`, () => {
      assert.throws(() => Email.create(raw), InvalidEmailError);
    });
  }

  test('rechaza emails de más de 254 caracteres', () => {
    const raw = `${'a'.repeat(64)}@${'b'.repeat(186)}.com`;
    assert.equal(raw.length, 255);
    assert.throws(() => Email.create(raw), InvalidEmailError);
  });
});
