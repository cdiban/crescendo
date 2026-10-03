import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../../src/domain/decimal.ts';
import { computeDividendAmounts } from '../../../src/domain/dividend.ts';
import { InvalidDividendAmountError } from '../../../src/domain/errors.ts';

const d = Decimal.parse;
const str = (a: ReturnType<typeof computeDividendAmounts>) => ({
  gross: a.grossAmount.toString(),
  withholding: a.withholdingAmount.toString(),
  net: a.netAmount.toString(),
});

describe('computeDividendAmounts', () => {
  test('bruto con retención 15 % en USD redondeada a centavos', () => {
    const a = computeDividendAmounts({ currency: 'USD', grossAmount: d('12.34'), withholdingRate: d('0.15') });
    // 12.34 × 0.15 = 1.851 → 1.85
    assert.deepEqual(str(a), { gross: '12.34', withholding: '1.85', net: '10.49' });
  });

  test('half-up en la retención', () => {
    const a = computeDividendAmounts({ currency: 'USD', grossAmount: d('0.1'), withholdingRate: d('0.15') });
    // 0.015 → 0.02
    assert.deepEqual(str(a), { gross: '0.1', withholding: '0.02', net: '0.08' });
  });

  test('CLP: retención a 0 decimales', () => {
    const a = computeDividendAmounts({ currency: 'CLP', grossAmount: d('93179'), withholdingRate: d('0.15') });
    // 13976.85 → 13977
    assert.deepEqual(str(a), { gross: '93179', withholding: '13977', net: '79202' });
  });

  test('Chile sin retención: neto = bruto', () => {
    const a = computeDividendAmounts({ currency: 'CLP', grossAmount: d('244397.4456'), withholdingRate: d('0') });
    assert.deepEqual(str(a), { gross: '244397.4456', withholding: '0', net: '244397.4456' });
  });

  test('perShare × cantidad, bruto redondeado a la moneda', () => {
    const a = computeDividendAmounts({ currency: 'USD', perShare: d('0.2425'), quantity: d('123.456'), withholdingRate: d('0.15') });
    // 29.93808 → 29.94; 29.94 × 0.15 = 4.491 → 4.49
    assert.deepEqual(str(a), { gross: '29.94', withholding: '4.49', net: '25.45' });
  });

  test('perShare en CLP con fracciones', () => {
    const a = computeDividendAmounts({ currency: 'CLP', perShare: d('55.5'), quantity: d('115'), withholdingRate: d('0') });
    // 6382.5 → 6383
    assert.equal(a.grossAmount.toString(), '6383');
  });

  test('neto informado: se mantiene el bruto y se ajusta la retención', () => {
    const a = computeDividendAmounts({
      currency: 'USD',
      grossAmount: d('5.6404'),
      withholdingRate: d('0.15'),
      netAmount: d('4.7943655'),
    });
    assert.deepEqual(str(a), { gross: '5.6404', withholding: '0.846', net: '4.7944' });
  });

  test('neto informado junto a perShare: bruto por acción, retención = bruto − neto', () => {
    const a = computeDividendAmounts({ currency: 'USD', perShare: d('0.51'), quantity: d('10'), withholdingRate: d('0.15'), netAmount: d('4.3') });
    assert.deepEqual(str(a), { gross: '5.1', withholding: '0.8', net: '4.3' });
  });

  test('neto igual al bruto (retención 0) y neto 0 son válidos', () => {
    assert.equal(computeDividendAmounts({ currency: 'USD', grossAmount: d('5'), withholdingRate: d('0.15'), netAmount: d('5') }).withholdingAmount.toString(), '0');
    assert.equal(computeDividendAmounts({ currency: 'USD', grossAmount: d('5'), withholdingRate: d('0.15'), netAmount: d('0') }).withholdingAmount.toString(), '5');
  });

  for (const [field, input] of [
    ['netAmount', { grossAmount: d('10'), netAmount: d('10.01') }],
    ['withholdingRate', { grossAmount: d('10'), withholdingRate: d('2') }],
    ['quantity', { perShare: d('1'), quantity: d('0') }],
    ['grossAmount', { grossAmount: d('0') }],
  ] as const) {
    test(`el error indica el campo ${field}`, () => {
      assert.throws(
        () => computeDividendAmounts({ currency: 'USD', withholdingRate: d('0.15'), ...input }),
        (err: InvalidDividendAmountError) => err.field === field,
      );
    });
  }

  test('bruto con más de 4 decimales se redondea a 4', () => {
    const a = computeDividendAmounts({ currency: 'CLP', grossAmount: d('105524.386'), withholdingRate: d('0') });
    assert.equal(a.grossAmount.toString(), '105524.386');
    const b = computeDividendAmounts({ currency: 'USD', grossAmount: d('1.234567'), withholdingRate: d('0') });
    assert.equal(b.grossAmount.toString(), '1.2346');
  });

  for (const [name, input] of [
    ['bruto negativo', { grossAmount: d('-1') }],
    ['bruto cero', { grossAmount: d('0') }],
    ['tasa > 1', { grossAmount: d('10'), withholdingRate: d('1.01') }],
    ['tasa negativa', { grossAmount: d('10'), withholdingRate: d('-0.01') }],
    ['neto > bruto', { grossAmount: d('10'), netAmount: d('10.01') }],
    ['neto negativo', { grossAmount: d('10'), netAmount: d('-1') }],
    ['perShare sin cantidad', { perShare: d('1') }],
    ['perShare con cantidad 0', { perShare: d('1'), quantity: d('0') }],
    ['bruto y perShare a la vez', { grossAmount: d('1'), perShare: d('1'), quantity: d('1') }],
  ] as const) {
    test(`rechaza ${name}`, () => {
      assert.throws(
        () => computeDividendAmounts({ currency: 'USD', withholdingRate: d('0.15'), ...input }),
        InvalidDividendAmountError,
      );
    });
  }
});
