import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../../src/domain/decimal.ts';
import { computeHoldings, type PositionTrade } from '../../../src/domain/positions.ts';
import { cashFxEffect, exposureWeights } from '../../../src/domain/reporting.ts';

const d = Decimal.parse;
const trade = (side: 'BUY' | 'SELL', tradeDate: string, quantity: string, price: string, commission = '0'): PositionTrade => ({
  accountId: 'ib', instrumentId: 'ko', side, tradeDate, quantity: d(quantity), price: d(price), commission: d(commission), commissionTax: d('0'),
});
// USD→CLP según fecha: 900 en enero, 1000 en febrero, 950 en marzo.
const usdClp = (date: string) => d(date < '2025-02-01' ? '900' : date < '2025-03-01' ? '1000' : '950');

describe('costo promedio paralelo en moneda de reporte (caso a mano)', () => {
  //   BUY 10 @ 100 + 5  = 1005 USD × 900  = 904500 CLP
  //   BUY  5 @ 110      =  550 USD × 1000 = 550000 CLP   → costo 1555 USD / 1454500 CLP, 15 acciones
  //   SELL 6 @ 120 − 3  =  717 USD × 950  = 681150 CLP
  //     descarga USD 1555×6/15 = 622 → ganancia 95 USD; costo 933 USD
  //     descarga CLP 1454500×6/15 = 581800 → ganancia 99350 CLP; costo 872700 CLP
  const trades = [trade('BUY', '2025-01-10', '10', '100', '5'), trade('BUY', '2025-02-10', '5', '110'), trade('SELL', '2025-03-10', '6', '120', '3')];

  test('sin conversión, igual que antes', () => {
    const [h] = computeHoldings(trades);
    assert.deepEqual([h!.quantity.toString(), h!.costBasis.toString(), h!.realizedGain.toString(), h!.reporting], ['9', '933', '95', undefined]);
  });

  test('con conversión: compras a TC de su fecha, ventas descargan a costo promedio en reporte', () => {
    const [h] = computeHoldings(trades, undefined, { toReporting: (_instrumentId, amount, date) => amount.mul(usdClp(date)) });
    assert.equal(h!.reporting!.costBasis.toString(), '872700');
    assert.equal(h!.reporting!.realizedGain.toString(), '99350');
  });

  test('misma moneda (tasa 1): el costo en reporte es el original', () => {
    const [h] = computeHoldings(trades, undefined, { toReporting: (_instrumentId, amount) => amount });
    assert.equal(h!.reporting!.costBasis.toString(), h!.costBasis.toString());
    assert.equal(h!.reporting!.realizedGain.toString(), h!.realizedGain.toString());
  });

  test('vender todo deja el costo en reporte en 0', () => {
    const [h] = computeHoldings([...trades, trade('SELL', '2025-03-20', '9', '100')], undefined, { toReporting: (_i, amount, date) => amount.mul(usdClp(date)) });
    assert.equal(h!.reporting!.costBasis.toString(), '0');
    // 900 USD × 950 − 872700 = −17700 más los 99350 anteriores
    assert.equal(h!.reporting!.realizedGain.toString(), '81650');
  });
});

describe('efecto cambiario de caja', () => {
  const movements = [
    { amount: d('1000'), currency: 'USD' as const, date: '2025-01-10' },
    { amount: d('-500'), currency: 'USD' as const, date: '2025-03-10' },
    { amount: d('100000'), currency: 'CLP' as const, date: '2025-01-10' },
  ];
  const toClp = (amount: Decimal, currency: string, date: string) => (currency === 'CLP' ? amount : amount.mul(usdClp(date)));
  const toClpNow = (amount: Decimal, currency: string) => (currency === 'CLP' ? amount : amount.mul(d('980')));

  test('saldo a TC actual − Σ movimientos a TC de su fecha, por moneda', () => {
    // USD: 500 × 980 = 490000; Σ = 900000 − 475000 = 425000 → 65000. CLP: 0.
    const effect = cashFxEffect(movements, { atDate: toClp, atCurrent: toClpNow });
    assert.deepEqual(
      effect.map((e) => [e.currency, e.balance.toString(), e.balanceAtCurrentRate.toString(), e.fxEffect.toString()]),
      [['CLP', '100000', '100000', '0'], ['USD', '500', '490000', '65000']],
    );
  });
});

describe('exposición por moneda', () => {
  test('pesos que suman exactamente 1, ordenados por monto', () => {
    const weights = exposureWeights([
      { currency: 'CLP', amount: d('1') },
      { currency: 'USD', amount: d('1') },
      { currency: 'EUR', amount: d('1') },
    ]);
    assert.equal(Decimal.sum(weights.map((w) => w.weight)).toString(), '1');
    assert.deepEqual(weights.map((w) => w.weight.toString()), ['0.333334', '0.333333', '0.333333'].sort().reverse());
  });

  test('agrega por moneda y omite montos en cero', () => {
    const weights = exposureWeights([
      { currency: 'USD', amount: d('30') },
      { currency: 'CLP', amount: d('60') },
      { currency: 'USD', amount: d('10') },
      { currency: 'EUR', amount: d('0') },
    ]);
    assert.deepEqual(weights.map((w) => [w.currency, w.amount.toString(), w.weight.toString()]), [['CLP', '60', '0.6'], ['USD', '40', '0.4']]);
  });

  test('sin montos → lista vacía', () => {
    assert.deepEqual(exposureWeights([]), []);
  });
});
