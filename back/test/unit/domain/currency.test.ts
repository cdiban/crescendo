import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../../src/domain/decimal.ts';
import { isCurrency, roundToCurrency } from '../../../src/domain/currency.ts';

describe('Currency', () => {
  test('CLP redondea a 0 decimales, USD/EUR a 2 (half-up)', () => {
    assert.equal(roundToCurrency(Decimal.parse('1234.5'), 'CLP').toString(), '1235');
    assert.equal(roundToCurrency(Decimal.parse('1.005'), 'USD').toString(), '1.01');
    assert.equal(roundToCurrency(Decimal.parse('1.004'), 'EUR').toString(), '1');
  });

  test('isCurrency', () => {
    assert.ok(isCurrency('CLP') && isCurrency('USD') && isCurrency('EUR'));
    assert.ok(!isCurrency('ARS') && !isCurrency('usd'));
  });
});
