import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../../src/domain/decimal.ts';
import { FxRateUnavailableError } from '../../../src/domain/errors.ts';
import { FxTable, type FxQuote } from '../../../src/domain/fx.ts';

const d = Decimal.parse;
const q = (currency: FxQuote['currency'], date: string, rate: string): FxQuote => ({ currency, date, rate: d(rate) });

// USD publicado vie 2025-01-03 y lun 2025-01-06 (fin de semana sin dato); 2025-01-01 feriado sin dato.
const table = new FxTable([
  q('USD', '2025-01-06', '980'),
  q('USD', '2024-12-30', '995'),
  q('USD', '2025-01-03', '990'),
  q('EUR', '2025-01-03', '1030'),
  q('EUR', '2025-01-06', '1029'),
  q('CLF', '2025-01-04', '38500.5'),
]);

describe('FxTable', () => {
  test('CLP contra CLP es 1, sin datos', () => {
    assert.equal(new FxTable([]).rateToClp('CLP', '2025-01-01').toString(), '1');
  });

  test('día con publicación usa su valor', () => {
    assert.equal(table.rateToClp('USD', '2025-01-03').toString(), '990');
  });

  test('fin de semana usa el último en o antes (viernes)', () => {
    assert.equal(table.rateToClp('USD', '2025-01-04').toString(), '990');
    assert.equal(table.rateToClp('USD', '2025-01-05').toString(), '990');
  });

  test('feriado usa el día hábil anterior (incluso del año anterior)', () => {
    assert.equal(table.rateToClp('USD', '2025-01-01').toString(), '995');
  });

  test('sin dato en o antes → FX_RATE_UNAVAILABLE con moneda y fecha', () => {
    assert.throws(
      () => table.rateToClp('USD', '2024-12-29'),
      (err: FxRateUnavailableError) => err.code === 'FX_RATE_UNAVAILABLE' && err.message.includes('USD') && err.message.includes('2024-12-29'),
    );
    assert.throws(() => table.rateToClp('CLF', '2025-01-03'), FxRateUnavailableError);
  });

  test('cruces derivados vía CLP: A/B = (A/CLP) / (B/CLP)', () => {
    assert.equal(table.rate('USD', 'CLP', '2025-01-03').toString(), '990');
    assert.equal(table.rate('CLP', 'USD', '2025-01-03').toString(), '0.001010101');
    assert.equal(table.rate('EUR', 'USD', '2025-01-06').toString(), '1.05');
    assert.equal(table.rate('USD', 'USD', '2025-01-06').toString(), '1');
  });

  test('convert: multiplica primero y divide una sola vez (sin perder precisión)', () => {
    // 1000 USD → CLP a 990 = 990000; 990000 CLP → USD = 1000 exacto
    assert.equal(table.convert(d('1000'), 'USD', 'CLP', '2025-01-03').toString(), '990000');
    assert.equal(table.convert(d('990000'), 'CLP', 'USD', '2025-01-03').toString(), '1000');
    assert.equal(table.convert(d('100'), 'EUR', 'USD', '2025-01-06').toString(), '105');
    assert.equal(table.convert(d('12.34'), 'USD', 'USD', '2020-01-01').toString(), '12.34');
  });

  test('latestDate: fecha del último dato en o antes de una fecha', () => {
    assert.equal(table.latestDate('USD', '2025-01-05'), '2025-01-03');
    assert.equal(table.latestDate('USD', '2030-01-01'), '2025-01-06');
    assert.equal(table.latestDate('USD', '2024-01-01'), null);
    assert.equal(table.latestDate('CLP', '2025-01-05'), null);
  });

  test('quotes de una moneda en un rango, ordenados', () => {
    assert.deepEqual(table.quotes('USD', '2024-12-31', '2025-01-06').map((x) => x.date), ['2025-01-03', '2025-01-06']);
  });
});
