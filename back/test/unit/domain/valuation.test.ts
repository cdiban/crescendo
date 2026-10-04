import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../../src/domain/decimal.ts';
import { reportingMarketValue, valuePosition } from '../../../src/domain/valuation.ts';

const d = Decimal.parse;

describe('valuePosition (moneda original)', () => {
  const base = {
    quantity: d('9'),
    costBasis: d('933'),
    realizedGain: d('95'),
    dividendsNet: d('8.5'),
    totalBought: d('1555'),
    annualDividendPerShare: d('2.04'),
  };

  test('valor, ganancia no realizada, rentabilidades, yield y variación del día', () => {
    const v = valuePosition({ ...base, price: d('120'), previousClose: d('118') });
    // 9 × 120 = 1080; no realizada 147 (147/933); total (147 + 95 + 8.5) / 1555; yield 2.04/120; día 120/118 − 1
    assert.deepEqual(
      Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x?.toString() ?? null])),
      {
        marketValue: '1080',
        unrealizedGain: '147',
        unrealizedReturn: '0.157556',
        totalReturn: '0.161093',
        positionReturn: '0.155627',
        currentYield: '0.017',
        dayChange: '0.016949',
      },
    );
  });

  test('positionReturn: sin ventas es igual a unrealizedReturn', () => {
    // compró 10 a 120 (1200), precio 150 → no realizada 300; 300 / 1200 = 0.25 en ambos
    const v = valuePosition({ ...base, quantity: d('10'), costBasis: d('1200'), realizedGain: d('0'), totalBought: d('1200'), price: d('150'), previousClose: null });
    assert.equal(v.positionReturn?.toString(), '0.25');
    assert.deepEqual(v.positionReturn, v.unrealizedReturn);
  });

  test('positionReturn: con venta parcial y dividendos, totalReturn − positionReturn = dividendos netos / total comprado', () => {
    // compró 10 a 200 (2000), vendió 4 con ganancia 100 → quedan 6 con costo 1200; precio 250 → valor 1500, no realizada 300
    // posición (300 + 100) / 2000 = 0.2; total (300 + 100 + 50) / 2000 = 0.225; dividendos 50 / 2000 = 0.025
    const v = valuePosition({
      ...base,
      quantity: d('6'),
      costBasis: d('1200'),
      realizedGain: d('100'),
      dividendsNet: d('50'),
      totalBought: d('2000'),
      price: d('250'),
      previousClose: null,
    });
    assert.deepEqual([v.positionReturn?.toString(), v.totalReturn?.toString(), v.unrealizedReturn?.toString()], ['0.2', '0.225', '0.25']);
    assert.equal(v.totalReturn!.sub(v.positionReturn!).toString(), '0.025');
  });

  test('positionReturn: null sin total comprado (mismo caso que totalReturn)', () => {
    const v = valuePosition({ ...base, quantity: d('0'), costBasis: d('0'), totalBought: d('0'), price: d('100'), previousClose: null });
    assert.deepEqual([v.totalReturn, v.positionReturn], [null, null]);
  });

  test('sin precio: todo null', () => {
    const v = valuePosition({ ...base, price: null, previousClose: null });
    assert.ok(Object.values(v).every((x) => x === null));
  });

  test('sin cierre anterior ni dividendo esperado: esos campos null', () => {
    const v = valuePosition({ ...base, annualDividendPerShare: null, price: d('100'), previousClose: null });
    assert.equal(v.dayChange, null);
    assert.equal(v.currentYield, null);
    assert.equal(v.marketValue?.toString(), '900');
  });

  test('posición cerrada: valor 0, sin rentabilidad no realizada, la total usa lo realizado', () => {
    const v = valuePosition({ ...base, quantity: d('0'), costBasis: d('0'), price: d('100'), previousClose: null });
    assert.deepEqual([v.marketValue?.toString(), v.unrealizedGain?.toString(), v.unrealizedReturn, v.totalReturn?.toString()], ['0', '0', null, '0.066559']);
    assert.equal(v.positionReturn?.toString(), '0.061093'); // 95 / 1555
  });

  test('equivale a la "Rentabilidad" del Excel en una posición sin ventas: (valor + dividendos − invertido) / invertido', () => {
    // 9209 × 147.5 = 1358327.5; dividendos 35714; invertido 1198027.3821 → 0.163614...
    const v = valuePosition({
      quantity: d('9209'),
      costBasis: d('1198027.3821'),
      realizedGain: d('0'),
      dividendsNet: d('35714'),
      totalBought: d('1198027.3821'),
      annualDividendPerShare: null,
      price: d('147.5'),
      previousClose: null,
    });
    assert.equal(v.totalReturn?.toString(), '0.163614');
  });
});

describe('reportingMarketValue: invariante exacto valor − costo = efecto precio + efecto cambiario', () => {
  test('USD reportado en CLP', () => {
    // valor 1080 USD × 980 = 1058400; costo en reporte 872700; costo a TC actual 914340
    const r = reportingMarketValue({
      marketValue: d('1080'),
      toCurrent: (x) => x.mul(d('980')),
      costBasis: d('872700'),
      costBasisAtCurrentRate: d('914340'),
    });
    assert.deepEqual([r.marketValue?.toString(), r.priceEffect?.toString(), r.unrealizedGain?.toString()], ['1058400', '144060', '185700']);
    // (1080 − 933) × 980 = 144060 = efecto precio; 41640 = efecto cambiario
    assert.ok(r.marketValue!.sub(d('872700')).eq(r.priceEffect!.add(d('914340').sub(d('872700')))));
  });

  test('con redondeo: se cumple exacto igual', () => {
    const r = reportingMarketValue({
      marketValue: d('102.0408'),
      toCurrent: (x) => x.div(d('983.84'), 10).mul(d('1')),
      costBasis: d('0.1111'),
      costBasisAtCurrentRate: d('0.1037'),
    });
    assert.ok(r.unrealizedGain!.eq(r.priceEffect!.add(d('0.1037').sub(d('0.1111')))));
  });

  test('sin precio → nulls', () => {
    const r = reportingMarketValue({ marketValue: null, toCurrent: (x) => x, costBasis: d('1'), costBasisAtCurrentRate: d('1') });
    assert.deepEqual([r.marketValue, r.priceEffect, r.unrealizedGain], [null, null, null]);
  });
});
