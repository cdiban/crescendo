import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../../src/domain/decimal.ts';
import { tradeAmounts } from '../../../src/domain/trade.ts';

const d = Decimal.parse;

describe('tradeAmounts', () => {
  test('BUY: total = q×p + comisión + impuesto, sale de caja', () => {
    const a = tradeAmounts({ side: 'BUY', quantity: d('115'), price: d('2600.1'), commission: d('748'), commissionTax: d('142.12') });
    assert.equal(a.grossAmount.toString(), '299011.5');
    assert.equal(a.total.toString(), '299901.62');
    assert.equal(a.cashAmount.toString(), '-299901.62');
  });

  test('SELL: total = q×p − comisión − impuesto, entra a caja', () => {
    const a = tradeAmounts({ side: 'SELL', quantity: d('6'), price: d('113.9'), commission: d('1.02'), commissionTax: d('0') });
    assert.equal(a.grossAmount.toString(), '683.4');
    assert.equal(a.total.toString(), '682.38');
    assert.equal(a.cashAmount.toString(), '682.38');
  });

  test('redondea montos a 4 decimales (escala de la BD)', () => {
    const a = tradeAmounts({ side: 'BUY', quantity: d('0.123456'), price: d('123.45'), commission: d('0'), commissionTax: d('0') });
    assert.equal(a.grossAmount.toString(), '15.2406');
  });
});
