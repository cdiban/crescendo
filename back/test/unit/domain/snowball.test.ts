import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../../src/domain/decimal.ts';
import { simulateSnowball, type SnowballInput } from '../../../src/domain/snowball.ts';

const d = Decimal.parse;
const base: SnowballInput = {
  startNetWorth: d('1000'),
  startYield: d('0.06'),
  monthlyContribution: d('0'),
  contributionGrowth: d('0'),
  reinvestDividends: false,
  dividendGrowth: d('0'),
  priceGrowth: d('0'),
  years: 3,
  startYear: 2026,
  monthlyGoal: null,
};

describe('simulateSnowball', () => {
  test('sin aportes, sin crecimiento y sin reinversión: el valor invertido queda constante (el patrimonio suma los dividendos apartados)', () => {
    const r = simulateSnowball(base);
    // 1000 × 6 % / 12 = 5 al mes = 60 al año, apartados.
    assert.deepEqual(
      r.years.map((y) => [y.year, y.calendarYear, y.netWorth.toString(), y.annualDividendsNet.toString(), y.monthlyDividendsNet.toString(), y.dividendsCumulative.toString(), y.contributedCumulative.toString()]),
      [
        [1, 2027, '1060', '60', '5', '60', '0'],
        [2, 2028, '1120', '60', '5', '120', '0'],
        [3, 2029, '1180', '60', '5', '180', '0'],
      ],
    );
    for (const y of r.years) assert.equal(y.netWorth.sub(y.dividendsCumulative).toString(), '1000');
  });

  test('con yield 0 el patrimonio queda exactamente constante', () => {
    const r = simulateSnowball({ ...base, startYield: d('0') });
    assert.ok(r.years.every((y) => y.netWorth.eq(d('1000')) && y.annualDividendsNet.isZero()));
  });

  test('reinvertir vs no reinvertir: el interés compuesto aparece desde el primer año', () => {
    const input = { ...base, startNetWorth: d('1200'), startYield: d('0.12'), years: 2 };
    const reinvest = simulateSnowball({ ...input, reinvestDividends: true });
    const apart = simulateSnowball(input);
    // 1 % mensual compuesto: 1200 × 1.01^12 = 1352.1900…; dividendos del año 152.19 vs 144 sin reinvertir.
    assert.deepEqual(reinvest.years.map((y) => [y.netWorth.toString(), y.annualDividendsNet.toString()]), [
      ['1352.19', '152.19'],
      ['1523.6816', '171.4915'],
    ]);
    assert.deepEqual(apart.years.map((y) => [y.netWorth.toString(), y.annualDividendsNet.toString()]), [
      ['1344', '144'],
      ['1488', '144'],
    ]);
  });

  test('la meta se cruza en el año correcto', () => {
    // Desde 0, aporte 1000/mes, 1 % mensual sin reinvertir: dividendos del año k = 10 × (144 (k−1) + 78)
    // → 65, 185, 305 al mes. Meta 200/mes → se alcanza el año 3 (2029).
    const r = simulateSnowball({ ...base, startNetWorth: d('0'), startYield: d('0.12'), monthlyContribution: d('1000'), monthlyGoal: d('200') });
    assert.deepEqual(r.years.map((y) => [y.monthlyDividendsNet.toString(), y.goalCoverage?.toString()]), [
      ['65', '0.325'],
      ['185', '0.925'],
      ['305', '1.525'],
    ]);
    assert.equal(r.goalReachedYear, 2029);
    assert.equal(r.years[2]!.contributedCumulative.toString(), '36000');
  });

  test('sin meta: coverage null y goalReachedYear null; meta no alcanzada: null', () => {
    assert.equal(simulateSnowball(base).goalReachedYear, null);
    assert.equal(simulateSnowball(base).years[0]!.goalCoverage, null);
    assert.equal(simulateSnowball({ ...base, monthlyGoal: d('1000') }).goalReachedYear, null);
  });

  test('crecimientos anuales: precio, dividendo (yield × (1+dg)/(1+pg)) y aporte', () => {
    const r = simulateSnowball({ ...base, startYield: d('0'), priceGrowth: d('0.04'), monthlyContribution: d('100'), contributionGrowth: d('0.1'), years: 2 });
    // Año 1: (1000 + 1200) × 1.04 = 2288; año 2: aporte 110/mes → (2288 + 1320) × 1.04 = 3752.32
    assert.deepEqual(r.years.map((y) => [y.netWorth.toString(), y.contributedCumulative.toString()]), [
      ['2288', '1200'],
      ['3752.32', '2520'],
    ]);
    const y = simulateSnowball({ ...base, startYield: d('0.104'), priceGrowth: d('0.04'), dividendGrowth: d('0.05'), years: 2 });
    // Año 1: 1000 × 0.104 = 104; precio → 1040; yield → 0.104 × 1.05 / 1.04 = 0.105 → año 2: 1040 × 0.105 = 109.2 (= 104 × 1.05)
    assert.deepEqual(y.years.map((p) => p.annualDividendsNet.toString()), ['104', '109.2']);
  });
});
