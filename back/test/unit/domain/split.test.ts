import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../../src/domain/decimal.ts';
import { InsufficientPositionError } from '../../../src/domain/errors.ts';
import { computeHoldings, firstNegativeQuantityDate, quantityAt, type PositionTrade } from '../../../src/domain/positions.ts';
import { perShareAt, sharesAt, type SplitEvent } from '../../../src/domain/split.ts';

const d = Decimal.parse;
const trade = (side: 'BUY' | 'SELL', tradeDate: string, quantity: string, price: string, accountId = 'acc-1'): PositionTrade => ({
  accountId, instrumentId: 'ins-1', side, tradeDate, quantity: d(quantity), price: d(price), commission: Decimal.ZERO, commissionTax: Decimal.ZERO,
});
const split = (effectiveDate: string, numerator: number, denominator: number, instrumentId = 'ins-1'): SplitEvent => ({ instrumentId, effectiveDate, numerator, denominator });

describe('splits en HoldingsBook (fase 6)', () => {
  test('2:1 con compra antes y venta después: posición 5, costo 250, realizada 150 (900 − 750)', () => {
    const trades = [trade('BUY', '2025-05-02', '10', '100'), trade('SELL', '2025-07-01', '15', '60')];
    const [h] = computeHoldings(trades, undefined, undefined, [split('2025-06-02', 2, 1)]);
    assert.deepEqual(
      [h!.quantity.toString(), h!.costBasis.toString(), h!.realizedGain.toString(), h!.totalBought.toString(), h!.averageCost.toString()],
      ['5', '250', '150', '1000', '50'],
    );
    // Sin el split, vender 15 de 10 no se puede.
    assert.throws(() => computeHoldings(trades), InsufficientPositionError);
    assert.equal(firstNegativeQuantityDate(trades), '2025-07-01');
    assert.equal(firstNegativeQuantityDate(trades, [split('2025-06-02', 2, 1)]), null);
  });

  test('el costo total no cambia y el costo promedio sale solo (también en reporte)', () => {
    const conversion = { toReporting: (_: string, amount: Decimal) => amount.mul(d('900')) };
    const [h] = computeHoldings([trade('BUY', '2025-01-10', '331.794', '20')], '2026-11-19', conversion, [split('2026-11-19', 1, 2)]);
    assert.deepEqual([h!.quantity.toString(), h!.costBasis.toString(), h!.averageCost.toString()], ['165.897', '6635.88', '40']);
    assert.equal(h!.reporting!.costBasis.toString(), '5972292');
    // asOf anterior al split: aún no se aplica.
    const [before] = computeHoldings([trade('BUY', '2025-01-10', '331.794', '20')], '2026-11-18', undefined, [split('2026-11-19', 1, 2)]);
    assert.equal(before!.quantity.toString(), '331.794');
  });

  test('un split el mismo día que una compra se aplica antes de la compra', () => {
    const trades = [trade('BUY', '2025-01-10', '10', '10'), trade('BUY', '2025-06-02', '4', '5')];
    const [h] = computeHoldings(trades, undefined, undefined, [split('2025-06-02', 2, 1)]);
    assert.equal(h!.quantity.toString(), '24');
    assert.equal(quantityAt(trades, '2025-06-02', [split('2025-06-02', 2, 1)]).toString(), '24');
    assert.equal(quantityAt(trades, '2025-06-01', [split('2025-06-02', 2, 1)]).toString(), '10');
  });

  test('3:2 sobre cantidad impar y 2:3 con redondeo a 10 decimales', () => {
    const [h] = computeHoldings([trade('BUY', '2025-01-10', '7', '10')], undefined, undefined, [split('2025-02-01', 3, 2)]);
    assert.deepEqual([h!.quantity.toString(), h!.costBasis.toString()], ['10.5', '70']);
    const [r] = computeHoldings([trade('BUY', '2025-01-10', '1', '10')], undefined, undefined, [split('2025-02-01', 2, 3)]);
    assert.deepEqual([r!.quantity.toString(), r!.averageCost.toString()], ['0.6666666667', '14.9999999993']);
    assert.equal(quantityAt([trade('BUY', '2025-01-10', '1', '10')], '2025-03-01', [split('2025-02-01', 2, 3)]).toString(), '0.6666666667');
  });

  test('reverse split 1 por 2 con ventas posteriores mayores que la mitad: posición negativa', () => {
    const trades = [trade('BUY', '2025-01-10', '10', '10'), trade('SELL', '2025-08-01', '6', '20')];
    assert.equal(firstNegativeQuantityDate(trades), null);
    assert.equal(firstNegativeQuantityDate(trades, [split('2025-06-02', 1, 2)]), '2025-08-01');
  });

  test('aplica a todas las cuentas del instrumento y no a otros instrumentos; posiciones cerradas siguen en 0', () => {
    const holdings = computeHoldings(
      [
        trade('BUY', '2025-01-10', '3', '10', 'acc-1'),
        trade('BUY', '2025-01-10', '5', '10', 'acc-2'),
        { ...trade('BUY', '2025-01-10', '7', '10'), instrumentId: 'ins-2' },
        trade('BUY', '2025-01-10', '1', '10', 'acc-3'),
        trade('SELL', '2025-02-10', '1', '10', 'acc-3'),
      ],
      undefined,
      undefined,
      [split('2025-06-02', 2, 1)],
    );
    assert.deepEqual(
      holdings.map((h) => [h.accountId, h.instrumentId, h.quantity.toString()]),
      [['acc-1', 'ins-1', '6'], ['acc-1', 'ins-2', '7'], ['acc-2', 'ins-1', '10'], ['acc-3', 'ins-1', '0']],
    );
  });
});

describe('normalización por split', () => {
  const splits = [split('2025-06-02', 2, 1), split('2026-11-19', 1, 2)];

  test('perShareAt divide por el factor de cada split en (desde, hasta]', () => {
    assert.equal(perShareAt(d('100'), splits, '2025-06-01', '2025-06-02').toString(), '50');
    assert.equal(perShareAt(d('100'), splits, '2025-06-02', '2025-06-03').toString(), '100');
    assert.equal(perShareAt(d('8.31'), splits, '2026-11-18', '2026-11-19').toString(), '16.62');
    // Los dos splits se anulan.
    assert.equal(perShareAt(d('100'), splits, '2025-01-01', '2026-12-31').toString(), '100');
    assert.equal(perShareAt(d('1'), [split('2025-06-02', 3, 1)], '2025-01-01', '2025-12-31').toString(), '0.3333333333');
  });

  test('sin splits en el rango devuelve el mismo valor (instrumentos sin splits no cambian)', () => {
    const value = d('123.456789012345');
    assert.equal(perShareAt(value, [], '2000-01-01', '2030-01-01'), value);
    assert.equal(perShareAt(value, splits, '2025-06-02', '2026-11-18'), value);
    assert.equal(sharesAt(value, [], '2000-01-01', '2030-01-01'), value);
  });

  test('sharesAt multiplica por el factor (cantidad de entonces en acciones de hoy)', () => {
    assert.equal(sharesAt(d('331.794'), splits, '2026-01-06', '2026-11-19').toString(), '165.897');
    assert.equal(sharesAt(d('10'), splits, '2025-01-01', '2025-12-31').toString(), '20');
  });
});
