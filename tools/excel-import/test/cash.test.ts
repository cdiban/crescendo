import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../../back/src/domain/decimal.ts';
import { inferCashMovements, type CashFlow } from '../src/cash.ts';

const d = Decimal.parse;
const flow = (date: string, amount: string, accountKey = 'itau', currency: 'CLP' | 'USD' = 'CLP'): CashFlow => ({ accountKey, currency, date, amount: d(amount) });
const show = (ms: ReturnType<typeof inferCashMovements>) => ms.map((m) => [m.accountKey, m.date, m.type, m.amount, m.currency]);

describe('inferCashMovements (aportes inferidos)', () => {
  test('inserta un DEPOSIT el mismo día por el faltante cuando un movimiento deja la caja negativa', () => {
    const result = inferCashMovements({
      flows: [flow('2025-01-10', '-1000'), flow('2025-02-01', '300'), flow('2025-02-10', '-500')],
      targets: [{ accountKey: 'itau', currency: 'CLP', amount: d('0') }],
      cutoffDate: '2026-10-03',
    });
    assert.deepEqual(show(result), [
      ['itau', '2025-01-10', 'DEPOSIT', '1000', 'CLP'],
      ['itau', '2025-02-10', 'DEPOSIT', '200', 'CLP'],
    ]);
  });

  test('el mismo día procesa primero las entradas (no infla aportes)', () => {
    const result = inferCashMovements({
      flows: [flow('2025-01-10', '-100'), flow('2025-01-10', '100')],
      targets: [{ accountKey: 'itau', currency: 'CLP', amount: d('0') }],
      cutoffDate: '2026-10-03',
    });
    assert.deepEqual(show(result), []);
  });

  test('residuo final positivo → DEPOSIT "Aporte no asignado" a cutoffDate (cuenta como aporte)', () => {
    const up = inferCashMovements({
      flows: [flow('2025-01-10', '-1000')],
      targets: [{ accountKey: 'itau', currency: 'CLP', amount: d('1500000') }],
      cutoffDate: '2026-10-03',
    });
    assert.deepEqual(show(up), [
      ['itau', '2025-01-10', 'DEPOSIT', '1000', 'CLP'],
      ['itau', '2026-10-03', 'DEPOSIT', '1500000', 'CLP'],
    ]);
    assert.deepEqual([up[1]!.description, up[1]!.importRole], ['Aporte no asignado (importación)', 'UNASSIGNED_DEPOSIT']);
    assert.equal(up[0]!.importRole, 'INFERRED_CONTRIBUTION');
  });

  test('residuo final negativo → ADJUSTMENT a cutoffDate', () => {
    const down = inferCashMovements({
      flows: [flow('2025-01-10', '50.5', 'ib', 'USD')],
      targets: [{ accountKey: 'ib', currency: 'USD', amount: d('20.5') }],
      cutoffDate: '2026-10-03',
    });
    assert.deepEqual(show(down), [['ib', '2026-10-03', 'ADJUSTMENT', '-30', 'USD']]);
    assert.deepEqual([down[0]!.description, down[0]!.importRole], ['Ajuste al saldo del Excel (importación)', 'RESIDUAL_ADJUSTMENT']);
  });

  test('cuentas y monedas independientes; orden cronológico sin importar la entrada', () => {
    const result = inferCashMovements({
      flows: [flow('2025-03-01', '-10', 'ib', 'USD'), flow('2025-01-01', '-5', 'itau'), flow('2025-02-01', '-7', 'ib', 'USD')],
      targets: [
        { accountKey: 'itau', currency: 'CLP', amount: d('0') },
        { accountKey: 'ib', currency: 'USD', amount: d('0') },
      ],
      cutoffDate: '2026-10-03',
    });
    assert.deepEqual(show(result), [
      ['ib', '2025-02-01', 'DEPOSIT', '7', 'USD'],
      ['ib', '2025-03-01', 'DEPOSIT', '10', 'USD'],
      ['itau', '2025-01-01', 'DEPOSIT', '5', 'CLP'],
    ]);
  });

  test('sin ajuste si el saldo ya coincide; descripción identifica el origen', () => {
    const result = inferCashMovements({
      flows: [flow('2025-01-10', '-1000')],
      targets: [{ accountKey: 'itau', currency: 'CLP', amount: d('0') }],
      cutoffDate: '2026-10-03',
    });
    assert.equal(result.length, 1);
    assert.equal(result[0]!.description, 'Aporte inferido (importación)');
  });
});
