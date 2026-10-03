import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../../src/domain/decimal.ts';
import { InvalidDecimalError } from '../../../src/domain/errors.ts';

const d = Decimal.parse;

describe('Decimal', () => {
  describe('parse / toString', () => {
    for (const [raw, out] of [
      ['0', '0'],
      ['-0', '0'],
      ['1234.5', '1234.5'],
      ['1234.5000', '1234.5'],
      ['-0.15', '-0.15'],
      ['123.456', '123.456'],
      ['000123', '123'],
      ['0.0000000001', '0.0000000001'],
      ['123456789012345678.1234567890', '123456789012345678.123456789'],
    ] as const) {
      test(`${raw} → ${out}`, () => assert.equal(d(raw).toString(), out));
    }

    for (const raw of ['', ' 1', '1.', '.5', '1e3', '1,5', 'abc', '--1', '+1', '1.2.3', 'NaN']) {
      test(`rechaza ${JSON.stringify(raw)}`, () => assert.throws(() => d(raw), InvalidDecimalError));
    }

    test('fromInt', () => assert.equal(Decimal.fromInt(42).toString(), '42'));
    test('ZERO', () => assert.ok(Decimal.ZERO.isZero()));
  });

  describe('aritmética exacta', () => {
    test('suma sin error de punto flotante (0.1 + 0.2)', () => assert.equal(d('0.1').add(d('0.2')).toString(), '0.3'));
    test('suma con escalas distintas', () => assert.equal(d('1.005').add(d('2')).toString(), '3.005'));
    test('resta a negativo', () => assert.equal(d('1').sub(d('1.25')).toString(), '-0.25'));
    test('multiplicación', () => assert.equal(d('2600.1').mul(d('115')).toString(), '299011.5'));
    test('multiplicación con fracciones', () => assert.equal(d('123.456').mul(d('12.078589944')).toString(), '1491.174400126464'));
    test('negación y valor absoluto', () => {
      assert.equal(d('1.5').neg().toString(), '-1.5');
      assert.equal(d('-1.5').abs().toString(), '1.5');
    });
    test('valores grandes sin pérdida', () => {
      assert.equal(d('999999999999999999.9999999999').add(d('0.0000000001')).toString(), '1000000000000000000');
    });
  });

  describe('div (escala fija, half-up)', () => {
    test('1 / 3 a 4 decimales', () => assert.equal(d('1').div(d('3'), 4).toString(), '0.3333'));
    test('2 / 3 a 4 decimales redondea hacia arriba', () => assert.equal(d('2').div(d('3'), 4).toString(), '0.6667'));
    test('-2 / 3 redondea alejándose de cero', () => assert.equal(d('-2').div(d('3'), 4).toString(), '-0.6667'));
    test('división exacta', () => assert.equal(d('10.2').div(d('0.85'), 4).toString(), '12'));
    test('a 0 decimales', () => assert.equal(d('7').div(d('2'), 0).toString(), '4'));
    test('por cero lanza', () => assert.throws(() => d('1').div(d('0'), 2), RangeError));
  });

  describe('round (half-up, alejándose de cero en .5)', () => {
    for (const [value, scale, out] of [
      ['1.005', 2, '1.01'],
      ['1.004', 2, '1'],
      ['-1.005', 2, '-1.01'],
      ['2.5', 0, '3'],
      ['-2.5', 0, '-3'],
      ['0.49999', 0, '0'],
      ['1.23', 4, '1.23'],
      ['1234.5', 0, '1235'],
    ] as const) {
      test(`${value} @${scale} → ${out}`, () => assert.equal(d(value).round(scale).toString(), out));
    }
  });

  describe('comparaciones', () => {
    test('cmp / eq / lt / gt', () => {
      assert.equal(d('1.10').cmp(d('1.1')), 0);
      assert.ok(d('1.10').eq(d('1.1')));
      assert.ok(d('-1').lt(d('0')));
      assert.ok(d('0.0001').gt(d('0')));
      assert.ok(d('2').gte(d('2.0')) && d('2').lte(d('2')));
    });
    test('signo', () => {
      assert.ok(d('0.00').isZero());
      assert.ok(d('-0.1').isNegative() && !d('-0.1').isPositive());
      assert.ok(d('0.1').isPositive() && !d('0').isPositive() && !d('0').isNegative());
    });
    test('min / max', () => {
      assert.equal(Decimal.max(d('1'), d('2.5')).toString(), '2.5');
      assert.equal(Decimal.min(d('1'), d('-2')).toString(), '-2');
    });
  });

  describe('toFixed y decimales', () => {
    test('toFixed rellena con ceros', () => assert.equal(d('1.5').toFixed(4), '1.5000'));
    test('toFixed redondea', () => assert.equal(d('1.23456').toFixed(2), '1.23'));
    test('decimalPlaces cuenta los decimales significativos', () => {
      assert.equal(d('1.2300').decimalPlaces(), 2);
      assert.equal(d('100').decimalPlaces(), 0);
    });
    test('integerDigits', () => {
      assert.equal(d('-123.45').integerDigits(), 3);
      assert.equal(d('0.5').integerDigits(), 1);
    });
  });

  test('sum de una lista', () => {
    assert.equal(Decimal.sum([d('1.1'), d('2.2'), d('-0.3')]).toString(), '3');
    assert.equal(Decimal.sum([]).toString(), '0');
  });
});
