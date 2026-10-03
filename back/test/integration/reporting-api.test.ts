import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../src/domain/decimal.ts';
import { expectStatus, startApi, type Api, type ApiHarness } from '../support/api-client.ts';

// Caso a mano. USD/CLP: 900 (10-ene), 1000 (10-feb), 950 (10-mar), 980 (1-sep = "actual" al 1-oct).
//  IB (USD): depósito 2000; KO compra 10@100+5, compra 5@110, venta 6@120−3; dividendo neto 8.5 (1-abr).
//  Itaú (CLP): depósito 200000; PEHUENCHE compra 100@1000; dividendo 5000 (20-may).
let h: ApiHarness;
let ana: Api;
let ko: { id: string };
let peh: { id: string };

before(async () => {
  h = await startApi();
});
after(() => h.close());
beforeEach(async () => {
  await h.reset();
  ana = await h.as('ana@example.com');
  await h.container.uow.transaction((r) =>
    r.fxRates.upsert(
      [['2025-01-10', '900'], ['2025-02-10', '1000'], ['2025-03-10', '950'], ['2025-09-01', '980']].map(([date, rate]) => ({
        currency: 'USD' as const, date: date!, rate: Decimal.parse(rate!), source: 'test',
      })),
    ),
  );
  const ib = await expectStatus(await ana.post('/accounts', { name: 'IB', broker: 'IB', baseCurrency: 'USD' }), 201);
  const itau = await expectStatus(await ana.post('/accounts', { name: 'Itaú', broker: 'Itaú', baseCurrency: 'CLP' }), 201);
  ko = await expectStatus(await ana.post('/instruments', { symbol: 'KO', marketCode: 'US', name: 'Coca-Cola', type: 'STOCK', annualDividendPerShare: '2.04' }), 201);
  peh = await expectStatus(await ana.post('/instruments', { symbol: 'PEHUENCHE', marketCode: 'XSGO', name: 'Pehuenche', type: 'STOCK', annualDividendPerShare: '266' }), 201);
  const post = async (path: string, body: unknown) => expectStatus(await ana.post(path, body), 201);
  await post('/cash-movements', { accountId: ib.id, date: '2025-01-10', type: 'DEPOSIT', amount: '2000', currency: 'USD' });
  await post('/cash-movements', { accountId: itau.id, date: '2025-01-10', type: 'DEPOSIT', amount: '200000', currency: 'CLP' });
  const t = (accountId: string, instrumentId: string, b: object) => post('/trades', { accountId, instrumentId, side: 'BUY', ...b });
  await t(ib.id, ko.id, { tradeDate: '2025-01-10', quantity: '10', price: '100', commission: '5' });
  await t(ib.id, ko.id, { tradeDate: '2025-02-10', quantity: '5', price: '110' });
  await t(ib.id, ko.id, { side: 'SELL', tradeDate: '2025-03-10', quantity: '6', price: '120', commission: '3' });
  await t(itau.id, peh.id, { tradeDate: '2025-01-10', quantity: '100', price: '1000' });
  await post('/dividends', { accountId: ib.id, instrumentId: ko.id, status: 'PAID', kind: 'REGULAR', paymentDate: '2025-04-01', grossAmount: '10' });
  await post('/dividends', { accountId: itau.id, instrumentId: peh.id, status: 'PAID', kind: 'FINAL', paymentDate: '2025-05-20', grossAmount: '5000' });
});

const reportingOf = (items: Array<{ symbol: string; reporting: Record<string, string | null> }>, symbol: string) =>
  items.find((i) => i.symbol === symbol)!.reporting;

function assertInvariant(r: { costBasis: string; costBasisAtCurrentRate: string; fxEffect: string }) {
  assert.equal(Decimal.parse(r.costBasisAtCurrentRate).sub(Decimal.parse(r.costBasis)).toString(), Decimal.parse(r.fxEffect).toString());
}

describe('posiciones en moneda de reporte', () => {
  test('CLP: filas CLP sin efecto cambiario; USD con costo histórico, a TC actual y efecto', async () => {
    const res = await expectStatus(await ana.get('/positions?reportingCurrency=CLP&asOf=2025-10-01'), 200);
    assert.equal(res.reportingCurrency, 'CLP');
    assert.equal(res.fxAsOf, '2025-09-01');
    assert.deepEqual(reportingOf(res.items, 'KO'), {
      currency: 'CLP',
      costBasis: '872700',
      costBasisAtCurrentRate: '914340',
      fxEffect: '41640',
      realizedGain: '99350',
      dividendsNet: '8075',
      expectedAnnualIncomeGross: '17992.8',
      marketValue: null,
      priceEffect: null,
      unrealizedGain: null,
    });
    assert.deepEqual(reportingOf(res.items, 'PEHUENCHE'), {
      currency: 'CLP',
      costBasis: '100000',
      costBasisAtCurrentRate: '100000',
      fxEffect: '0',
      realizedGain: '0',
      dividendsNet: '5000',
      expectedAnnualIncomeGross: '26600',
      marketValue: null,
      priceEffect: null,
      unrealizedGain: null,
    });
    assert.deepEqual(res.total, {
      currency: 'CLP',
      costBasis: '972700',
      costBasisAtCurrentRate: '1014340',
      fxEffect: '41640',
      realizedGain: '99350',
      dividendsNet: '13075',
      expectedAnnualIncomeGross: '44592.8',
      marketValue: null,
      priceEffect: null,
      unrealizedGain: null,
    });
    for (const r of [...res.items.map((i: { reporting: never }) => i.reporting), res.total]) assertInvariant(r);
  });

  test('USD (preferencia por defecto): filas USD sin efecto; CLP convertido', async () => {
    const res = await expectStatus(await ana.get('/positions?asOf=2025-10-01'), 200);
    assert.equal(res.reportingCurrency, 'USD');
    const k = reportingOf(res.items, 'KO');
    assert.deepEqual([k.costBasis, k.costBasisAtCurrentRate, k.fxEffect, k.realizedGain, k.dividendsNet], ['933', '933', '0', '95', '8.5']);
    const p = reportingOf(res.items, 'PEHUENCHE');
    assert.deepEqual(
      [p.costBasis, p.costBasisAtCurrentRate, p.fxEffect, p.dividendsNet, p.expectedAnnualIncomeGross],
      ['111.1111', '102.0408', '-9.0703', '5.2632', '27.1429'],
    );
    assert.deepEqual([res.total.costBasis, res.total.costBasisAtCurrentRate, res.total.fxEffect], ['1044.1111', '1035.0408', '-9.0703']);
    for (const r of [...res.items.map((i: { reporting: never }) => i.reporting), res.total]) assertInvariant(r);
  });

  test('totales por moneda original (sin conversión)', async () => {
    const res = await expectStatus(await ana.get('/positions?asOf=2025-10-01'), 200);
    assert.deepEqual(res.totalsByCurrency, [
      { currency: 'CLP', costBasis: '100000', realizedGain: '0', dividendsGross: '5000', dividendsNet: '5000', expectedAnnualIncomeGross: '26600', marketValue: '0', unrealizedGain: '0', pricedCoverage: '0' },
      { currency: 'USD', costBasis: '933', realizedGain: '95', dividendsGross: '10', dividendsNet: '8.5', expectedAnnualIncomeGross: '18.36', marketValue: '0', unrealizedGain: '0', pricedCoverage: '0' },
    ]);
  });

  test('la preferencia del usuario se usa si no viene el parámetro', async () => {
    await expectStatus(await ana.patch('/me/preferences', { reportingCurrency: 'CLP' }), 200);
    assert.equal((await expectStatus(await ana.get('/positions?asOf=2025-10-01'), 200)).total.fxEffect, '41640');
  });

  test('sin tipo de cambio para la fecha → 422 FX_RATE_UNAVAILABLE', async () => {
    await h.container.dataSource.query(`DELETE FROM fx_rates WHERE date = '2025-01-10'`);
    const problem = await expectStatus(await ana.get('/positions?reportingCurrency=CLP&asOf=2025-10-01'), 422);
    assert.equal(problem.code, 'FX_RATE_UNAVAILABLE');
    assert.match(problem.detail, /USD/);
  });

  test('validación de reportingCurrency', async () => {
    await expectStatus(await ana.get('/positions?reportingCurrency=CLF'), 400);
    await expectStatus(await ana.get('/portfolio/summary?reportingCurrency=ARS'), 400);
  });
});

describe('resumen del portafolio', () => {
  test('CLP: capital aportado, costo, caja, efecto cambiario, dividendos y exposición', async () => {
    const s = await expectStatus(await ana.get('/portfolio/summary?reportingCurrency=CLP&asOf=2025-10-01'), 200);
    assert.deepEqual(s, {
      reportingCurrency: 'CLP',
      asOf: '2025-10-01',
      fxAsOf: '2025-09-01',
      contributedCapital: '2000000',
      costBasis: '972700',
      costBasisAtCurrentRate: '1014340',
      cash: '1252090',
      // caja USD: 1170.5 × 980 = 1147090 − (1800000 − 904500 − 550000 + 681150 + 8075) = 112365
      fxEffect: { positions: '41640', cash: '112365', total: '154005' },
      realizedGain: '99350',
      // Sin precios cargados (v0.4): valor de mercado 0 y cobertura 0.
      marketValue: '0',
      netWorth: '1252090',
      priceEffect: '0',
      unrealizedGain: '0',
      totalGain: '-747910',
      pricedCoverage: '0',
      pricesAsOf: null,
      dividends: { netYearToDate: '13075', netLast12Months: '13075', netTotal: '13075', expectedAnnualGross: '44592.8', currentYield: null },
      exposure: [
        { currency: 'USD', amount: '2061430', weight: '0.909549' },
        { currency: 'CLP', amount: '205000', weight: '0.090451' },
      ],
    });
  });

  test('USD: aportes CLP a TC de su fecha, efecto de caja de la caja en CLP', async () => {
    const s = await expectStatus(await ana.get('/portfolio/summary?asOf=2025-10-01'), 200);
    assert.equal(s.reportingCurrency, 'USD');
    assert.equal(s.contributedCapital, '2222.2222');
    assert.equal(s.cash, '1277.6429');
    assert.deepEqual(s.fxEffect, { positions: '-9.0703', cash: '-9.2314', total: '-18.3017' });
    assert.equal(Decimal.sum(s.exposure.map((e: { weight: string }) => Decimal.parse(e.weight))).toString(), '1');
  });

  test('dividendos por período: año en curso, 12 meses y total', async () => {
    const s = await expectStatus(await ana.get('/portfolio/summary?reportingCurrency=CLP&asOf=2026-04-15'), 200);
    assert.deepEqual(s.dividends, { netYearToDate: '0', netLast12Months: '5000', netTotal: '13075', expectedAnnualGross: '44592.8', currentYield: null });
  });
});

describe('resumen de dividendos con bloque en moneda de reporte', () => {
  test('CLP y USD, cada dividendo a TC de su fecha de pago', async () => {
    const clp = await expectStatus(await ana.get('/dividends/summary?year=2025&reportingCurrency=CLP'), 200);
    assert.equal(clp.reporting.currency, 'CLP');
    assert.equal(clp.reporting.monthlyGross[3], '9500');
    assert.equal(clp.reporting.monthlyNet[3], '8075');
    assert.equal(clp.reporting.monthlyNet[4], '5000');
    assert.deepEqual([clp.reporting.totalGross, clp.reporting.totalNet], ['14500', '13075']);
    assert.equal(clp.groups.length, 2);

    const usd = await expectStatus(await ana.get('/dividends/summary?year=2025'), 200);
    assert.deepEqual([usd.reporting.currency, usd.reporting.monthlyNet[3], usd.reporting.monthlyNet[4], usd.reporting.totalNet], ['USD', '8.5', '5.2632', '13.7632']);
  });
});
