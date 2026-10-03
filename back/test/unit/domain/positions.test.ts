import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../../src/domain/decimal.ts';
import { InsufficientPositionError } from '../../../src/domain/errors.ts';
import { computeHoldings, firstNegativeQuantityDate, quantityAt, type PositionTrade } from '../../../src/domain/positions.ts';

const d = Decimal.parse;

function trade(
  side: 'BUY' | 'SELL',
  tradeDate: string,
  quantity: string,
  price: string,
  commission = '0',
  commissionTax = '0',
  accountId = 'acc-1',
  instrumentId = 'ins-1',
): PositionTrade {
  return {
    accountId,
    instrumentId,
    side,
    tradeDate,
    quantity: d(quantity),
    price: d(price),
    commission: d(commission),
    commissionTax: d(commissionTax),
  };
}

function show(h: ReturnType<typeof computeHoldings>[number]) {
  return {
    quantity: h.quantity.toString(),
    costBasis: h.costBasis.toString(),
    averageCost: h.averageCost.toString(),
    realizedGain: h.realizedGain.toString(),
    firstTradeDate: h.firstTradeDate,
  };
}

describe('computeHoldings (costo promedio ponderado)', () => {
  test('caso calculado a mano: compras con comisiones, fracciones y venta parcial', () => {
    // BUY 10 @ 100 + 5 + 0.95           → qty 10,   costo 1005.95
    // BUY 5.5 @ 110 + 2                 → qty 15.5, costo 1612.95
    // SELL 4 @ 120 − 3 − 0.57 = 476.43  → costo descargado 1612.95×4/15.5 = 416.2451612903
    //                                     ganancia 476.43 − 416.2451612903 = 60.1848387097
    //                                     costo 1196.7048387097, qty 11.5, promedio 104.0612903226
    const holdings = computeHoldings([
      trade('BUY', '2025-01-10', '10', '100', '5', '0.95'),
      trade('BUY', '2025-02-10', '5.5', '110', '2'),
      trade('SELL', '2025-03-10', '4', '120', '3', '0.57'),
    ]);

    assert.equal(holdings.length, 1);
    assert.deepEqual(show(holdings[0]!), {
      quantity: '11.5',
      costBasis: '1196.7048',
      averageCost: '104.0612903226',
      realizedGain: '60.1848',
      firstTradeDate: '2025-01-10',
    });
  });

  test('vender todo deja costo 0 exacto y la ganancia acumulada', () => {
    const [h] = computeHoldings([
      trade('BUY', '2025-01-10', '3', '10', '1'),
      trade('SELL', '2025-02-10', '1', '12'),
      trade('SELL', '2025-03-10', '2', '9', '1'),
    ]);
    // costo 31; vende 1 → descarga 10.3333333333, gana 1.6666666667; vende 2 (resto 20.6666666667) por 17 → −3.6666666667
    assert.deepEqual(show(h!), {
      quantity: '0',
      costBasis: '0',
      averageCost: '0',
      realizedGain: '-2',
      firstTradeDate: '2025-01-10',
    });
  });

  test('una fila por cuenta + instrumento, ordenadas', () => {
    const holdings = computeHoldings([
      trade('BUY', '2025-01-01', '1', '10', '0', '0', 'acc-2', 'ins-1'),
      trade('BUY', '2025-01-01', '2', '10', '0', '0', 'acc-1', 'ins-2'),
      trade('BUY', '2025-01-02', '3', '10', '0', '0', 'acc-1', 'ins-1'),
    ]);
    assert.deepEqual(
      holdings.map((h) => [h.accountId, h.instrumentId, h.quantity.toString()]),
      [
        ['acc-1', 'ins-1', '3'],
        ['acc-1', 'ins-2', '2'],
        ['acc-2', 'ins-1', '1'],
      ],
    );
  });

  test('ordena por fecha sin importar el orden de entrada; el mismo día compra antes que venta', () => {
    const [h] = computeHoldings([
      trade('SELL', '2025-01-10', '5', '11'),
      trade('BUY', '2025-01-10', '5', '10'),
    ]);
    assert.equal(h!.quantity.toString(), '0');
    assert.equal(h!.realizedGain.toString(), '5');
  });

  test('asOf ignora operaciones posteriores', () => {
    const [h] = computeHoldings(
      [trade('BUY', '2025-01-10', '5', '10'), trade('BUY', '2025-06-10', '5', '10')],
      '2025-03-01',
    );
    assert.equal(h!.quantity.toString(), '5');
  });

  test('vender más de lo que hay lanza InsufficientPosition', () => {
    assert.throws(
      () => computeHoldings([trade('BUY', '2025-01-10', '1', '10'), trade('SELL', '2025-01-11', '1.5', '10')]),
      InsufficientPositionError,
    );
  });
});

describe('firstNegativeQuantityDate', () => {
  test('null si nunca queda negativa', () => {
    assert.equal(
      firstNegativeQuantityDate([trade('BUY', '2025-01-01', '2', '1'), trade('SELL', '2025-02-01', '2', '1')]),
      null,
    );
  });

  test('detecta la primera fecha con cierre negativo aunque después se recupere', () => {
    assert.equal(
      firstNegativeQuantityDate([
        trade('BUY', '2025-01-01', '1', '1'),
        trade('SELL', '2025-02-01', '2', '1'),
        trade('BUY', '2025-03-01', '5', '1'),
      ]),
      '2025-02-01',
    );
  });

  test('evalúa el cierre del día (compra y venta el mismo día se compensan)', () => {
    assert.equal(firstNegativeQuantityDate([trade('SELL', '2025-01-01', '1', '1'), trade('BUY', '2025-01-01', '1', '1')]), null);
  });
});

describe('quantityAt', () => {
  test('cantidad al cierre de una fecha', () => {
    const trades = [trade('BUY', '2025-01-01', '10', '1'), trade('SELL', '2025-02-01', '3', '1'), trade('BUY', '2025-03-01', '0.5', '1')];
    assert.equal(quantityAt(trades, '2024-12-31').toString(), '0');
    assert.equal(quantityAt(trades, '2025-02-01').toString(), '7');
    assert.equal(quantityAt(trades, '2025-03-01').toString(), '7.5');
  });
});
