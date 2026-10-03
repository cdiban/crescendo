import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../../src/domain/decimal.ts';
import { allocate } from '../../../src/domain/allocation.ts';

const d = Decimal.parse;
const show = (r: ReturnType<typeof allocate>) =>
  r.items.map((i) => [i.key, i.label, i.value.toString(), i.weight.toString(), i.expectedAnnualIncomeGross.toString(), i.incomeWeight.toString(), i.valuedAtCost.toString()]);

describe('allocate', () => {
  // Energía: PEHUENCHE 600 (con precio) + COLBUN 200 al costo (sin precio); Consumo: KO 200. Ingreso: 30 + 10 + 10.
  const rows = [
    { key: 'energy', label: 'Energy', value: d('600'), valuedAtCost: d('0'), income: d('30') },
    { key: 'consumer', label: 'Consumer', value: d('200'), valuedAtCost: d('0'), income: d('10') },
    { key: 'energy', label: 'Energy', value: d('200'), valuedAtCost: d('200'), income: d('10') },
  ];

  test('agrupa, ordena por valor, pesos en valor e ingreso; el sin precio va al costo y se marca', () => {
    const r = allocate(rows);
    assert.equal(r.total.toString(), '1000');
    assert.deepEqual(show(r), [
      ['energy', 'Energy', '800', '0.8', '40', '0.8', '200'],
      ['consumer', 'Consumer', '200', '0.2', '10', '0.2', '0'],
    ]);
  });

  test('limit: los primeros N y un "Otros (k)" agregado; los pesos siguen sumando 1', () => {
    const many = ['a', 'b', 'c', 'd'].map((k, i) => ({ key: k, label: k.toUpperCase(), value: d(String(4 - i)), valuedAtCost: d('0'), income: d('1') }));
    // valores 4, 3, 2, 1 (total 10) → con limit 2: A, B, Otros (2) = 3
    const r = allocate([...many, { key: 'c', label: 'C', value: d('0'), valuedAtCost: d('0'), income: d('0') }], 2);
    assert.deepEqual(show(r), [
      ['a', 'A', '4', '0.4', '1', '0.25', '0'],
      ['b', 'B', '3', '0.3', '1', '0.25', '0'],
      ['__others', 'Otros (2)', '3', '0.3', '2', '0.5', '0'],
    ]);
    assert.equal(Decimal.sum(r.items.map((i) => i.weight)).toString(), '1');
  });

  test('pesos con redondeo suman exactamente 1 (residuo al mayor)', () => {
    const r = allocate(['x', 'y', 'z'].map((k) => ({ key: k, label: k, value: d('1'), valuedAtCost: d('0'), income: d('1') })));
    assert.equal(Decimal.sum(r.items.map((i) => i.weight)).toString(), '1');
    assert.equal(Decimal.sum(r.items.map((i) => i.incomeWeight)).toString(), '1');
  });

  test('sin ingreso esperado: incomeWeight 0; sin filas: total 0 y lista vacía', () => {
    const r = allocate([{ key: 'x', label: 'X', value: d('5'), valuedAtCost: d('0'), income: d('0') }]);
    assert.deepEqual(show(r), [['x', 'X', '5', '1', '0', '0', '0']]);
    assert.deepEqual(allocate([]), { total: Decimal.ZERO, items: [] });
  });
});
