import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../../src/domain/decimal.ts';
import { allocate, allocationValue, weightsByKey } from '../../../src/domain/allocation.ts';

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

describe('allocationValue: valor de mercado en reporte, o el costo a TC actual si no hay precio', () => {
  test('con precio usa el valor de mercado', () => {
    const v = allocationValue(d('1080'), d('933'));
    assert.deepEqual([v.value.toString(), v.atCost], ['1080', false]);
  });

  test('sin precio usa el costo y lo marca', () => {
    const v = allocationValue(null, d('100000'));
    assert.deepEqual([v.value.toString(), v.atCost], ['100000', true]);
  });
});

describe('weightsByKey: pesos de allocate por clave', () => {
  test('mismos pesos que allocate; las filas de una clave más fina suman el peso de la agrupada', () => {
    // KO en dos cuentas (300 + 100) y PEHUENCHE 600 → por instrumento 0.4 / 0.6; por fila 0.3 + 0.1 = 0.4
    const byInstrument = weightsByKey([
      { key: 'KO', value: d('300') },
      { key: 'PEH', value: d('600') },
      { key: 'KO', value: d('100') },
    ]);
    assert.deepEqual([...byInstrument].map(([k, w]) => [k, w.toString()]), [['PEH', '0.6'], ['KO', '0.4']]);
    const byRow = weightsByKey([
      { key: 'IB|KO', value: d('300') },
      { key: 'ITAU|PEH', value: d('600') },
      { key: 'ZESTY|KO', value: d('100') },
    ]);
    assert.equal(byRow.get('IB|KO')!.add(byRow.get('ZESTY|KO')!).toString(), byInstrument.get('KO')!.toString());
  });

  test('con redondeo los pesos suman exactamente 1 (el residuo va al mayor)', () => {
    const w = weightsByKey([{ key: 'a', value: d('1') }, { key: 'b', value: d('1') }, { key: 'c', value: d('1') }]);
    assert.equal(Decimal.sum([...w.values()]).toString(), '1');
    assert.deepEqual([...w.values()].map(String).sort(), ['0.333333', '0.333333', '0.333334']);
  });

  test('sin valor: vacío', () => {
    assert.equal(weightsByKey([]).size, 0);
  });
});
