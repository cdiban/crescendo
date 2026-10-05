import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../src/domain/decimal.ts';
import { SyncPrices } from '../../src/application/use-cases/sync-prices.ts';
import type { MarketDataProvider } from '../../src/application/ports/market-data-provider.ts';
import { expectStatus, startApi, type Api, type ApiHarness } from '../support/api-client.ts';

// Mismo caso a mano que reporting-api (USD/CLP 900/1000/950/980), más precios:
//   KO (9 acciones, costo 933 USD): cotización 120 USD el 1-oct (cierre anterior 118).
//   PEHUENCHE (100 acciones, costo 100000 CLP): cotización 1100 CLP el 1-oct.
const ASOF = '2025-10-01';
let h: ApiHarness;
let ana: Api;
let ko: { id: string };
let peh: { id: string };
const d = Decimal.parse;

async function quote(instrumentId: string, price: string, previousClose: string | null, date = ASOF) {
  await h.container.uow.transaction((r) =>
    r.prices.saveProviderQuote(instrumentId, { price: d(price), previousClose: previousClose ? d(previousClose) : null, asOf: new Date(`${date}T19:00:00Z`), date }),
  );
}

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
        currency: 'USD' as const, date: date!, rate: d(rate!), source: 'test',
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
  await quote(ko.id, '120', '118');
  await quote(peh.id, '1100', null);
});

const row = (items: Array<{ symbol: string }>, symbol: string) => items.find((i) => i.symbol === symbol) as Record<string, any>;
function assertInvariant(r: Record<string, string>) {
  const [mv, cb, pe, fx, ug] = ['marketValue', 'costBasis', 'priceEffect', 'fxEffect', 'unrealizedGain'].map((k) => d(r[k]!));
  assert.ok(mv!.sub(cb!).eq(pe!.add(fx!)), `valor − costo ≠ precio + TC en ${JSON.stringify(r)}`);
  assert.ok(ug!.eq(mv!.sub(cb!)));
}

describe('instrumentos: símbolo del proveedor y última cotización', () => {
  test('derivado por mercado, override y lastPrice', async () => {
    const k = await expectStatus(await ana.get(`/instruments/${ko.id}`), 200);
    assert.deepEqual([k.priceSymbol, k.effectivePriceSymbol], [null, 'KO']);
    assert.deepEqual(k.lastPrice, { date: '2025-10-01', price: '120', currency: 'USD', asOf: '2025-10-01T19:00:00.000Z', source: 'PROVIDER', previousClose: '118' });
    const p = await expectStatus(await ana.get(`/instruments/${peh.id}`), 200);
    assert.equal(p.effectivePriceSymbol, 'PEHUENCHE.SN');

    const created = await expectStatus(await ana.post('/instruments', { symbol: 'SAN', marketCode: 'XSGO', name: 'x', type: 'STOCK', priceSymbol: 'BSANTANDER.SN' }), 201);
    assert.deepEqual([created.priceSymbol, created.effectivePriceSymbol, created.lastPrice], ['BSANTANDER.SN', 'BSANTANDER.SN', null]);
    assert.equal((await expectStatus(await ana.patch(`/instruments/${ko.id}`, { priceSymbol: 'con espacio' }), 400)).code, 'VALIDATION_ERROR');
  });

  test('cambiar el símbolo descarta lo del proveedor (conserva lo manual) para que el worker recargue', async () => {
    await expectStatus(await ana.put(`/instruments/${ko.id}/prices`, { date: '2025-09-30', price: '119' }), 200);
    await h.container.uow.transaction((r) => r.prices.saveProviderCloses(ko.id, [{ date: '2025-09-29', close: d('117') }]));
    const k = await expectStatus(await ana.patch(`/instruments/${ko.id}`, { priceSymbol: 'KO.NE' }), 200);
    assert.deepEqual([k.effectivePriceSymbol, k.lastPrice], ['KO.NE', null]);
    const { items } = await expectStatus(await ana.get(`/instruments/${ko.id}/prices`), 200);
    assert.deepEqual(items, [{ date: '2025-09-30', close: '119', source: 'MANUAL' }]);
  });
});

describe('precios manuales', () => {
  test('PUT guarda el cierre MANUAL, pasa a ser la cotización actual y el proveedor no lo pisa para esa fecha', async () => {
    const res = await expectStatus(await ana.put(`/instruments/${ko.id}/prices`, { date: ASOF, price: '125' }), 200);
    assert.deepEqual([res.lastPrice.price, res.lastPrice.source], ['125', 'MANUAL']);

    // El proveedor intenta pisar el mismo día (cotización y cierre): se conserva lo manual.
    await quote(ko.id, '121', '118');
    await h.container.uow.transaction((r) => r.prices.saveProviderCloses(ko.id, [{ date: ASOF, close: d('121') }, { date: '2025-09-30', close: d('119') }]));
    const p = await expectStatus(await ana.get(`/positions?asOf=${ASOF}`), 200);
    assert.deepEqual([row(p.items, 'KO').marketPrice, row(p.items, 'KO').priceSource], ['125', 'MANUAL']);
    const { items } = await expectStatus(await ana.get(`/instruments/${ko.id}/prices?from=2025-09-30`), 200);
    assert.deepEqual(items, [
      { date: '2025-09-30', close: '119', source: 'PROVIDER' },
      { date: ASOF, close: '125', source: 'MANUAL' },
    ]);

    // Un día posterior del proveedor sí pasa a ser la cotización actual.
    await quote(ko.id, '126', '125', '2025-10-02');
    assert.equal((await expectStatus(await ana.get(`/instruments/${ko.id}`), 200)).lastPrice.source, 'PROVIDER');
  });

  test('cierres del proveedor: upsert idempotente (repetir no cambia nada)', async () => {
    const closes = [{ date: '2025-09-29', close: d('117') }, { date: '2025-09-30', close: d('119') }];
    assert.equal(await h.container.uow.transaction((r) => r.prices.saveProviderCloses(ko.id, closes)), 2);
    assert.equal(await h.container.uow.transaction((r) => r.prices.saveProviderCloses(ko.id, closes)), 0);
    assert.equal(await h.container.uow.transaction((r) => r.prices.saveProviderCloses(ko.id, [{ date: '2025-09-30', close: d('119.5') }])), 1);
  });

  test('un precio manual de una fecha antigua no reemplaza la cotización actual', async () => {
    const res = await expectStatus(await ana.put(`/instruments/${ko.id}/prices`, { date: '2025-05-01', price: '99' }), 200);
    assert.deepEqual([res.lastPrice.price, res.lastPrice.source], ['120', 'PROVIDER']);
  });

  test('validación y 404', async () => {
    for (const body of [{ date: ASOF }, { date: ASOF, price: '0' }, { date: ASOF, price: 120 }, { date: '2025-02-30', price: '1' }]) {
      assert.equal((await expectStatus(await ana.put(`/instruments/${ko.id}/prices`, body), 400)).code, 'VALIDATION_ERROR');
    }
    await expectStatus(await ana.put('/instruments/00000000-0000-0000-0000-000000000000/prices', { date: ASOF, price: '1' }), 404);
    await expectStatus(await ana.get('/instruments/00000000-0000-0000-0000-000000000000/prices'), 404);
  });
});

describe('posiciones a precio de mercado', () => {
  test('campos de mercado en moneda original', async () => {
    const p = await expectStatus(await ana.get(`/positions?asOf=${ASOF}`), 200);
    const k = row(p.items, 'KO');
    assert.deepEqual(
      [k.marketPrice, k.priceAsOf, k.priceSource, k.marketValue, k.unrealizedGain, k.unrealizedReturn, k.totalReturn, k.currentYield, k.dayChange],
      ['120', '2025-10-01T19:00:00.000Z', 'PROVIDER', '1080', '147', '0.157556', '0.161093', '0.017', '0.016949'],
    );
    const e = row(p.items, 'PEHUENCHE');
    assert.deepEqual([e.marketValue, e.unrealizedGain, e.totalReturn, e.dayChange], ['110000', '10000', '0.15', null]);
    // positionReturn (v0.6.1), sin dividendos. KO con venta parcial: (147 + 95) / 1555; la diferencia con
    // totalReturn es dividendos netos / total comprado = 8.5 / 1555. PEHUENCHE sin ventas: igual a unrealizedReturn.
    assert.equal(k.positionReturn, '0.155627');
    assert.equal(d(k.totalReturn).sub(d(k.positionReturn)).toString(), '0.005466');
    assert.deepEqual([e.positionReturn, e.unrealizedReturn], ['0.1', '0.1']);
    assert.deepEqual(
      p.totalsByCurrency.map((t: Record<string, string>) => [t.currency, t.marketValue, t.unrealizedGain, t.pricedCoverage]),
      [['CLP', '110000', '10000', '1'], ['USD', '1080', '147', '1']],
    );
  });

  test('positionReturn con groupBy=account e includeClosed', async () => {
    const byAccount = await expectStatus(await ana.get(`/positions?groupBy=account&asOf=${ASOF}`), 200);
    assert.ok(byAccount.items.every((i: { accountId: string | null }) => i.accountId));
    assert.deepEqual([row(byAccount.items, 'KO').positionReturn, row(byAccount.items, 'PEHUENCHE').positionReturn], ['0.155627', '0.1']);
    // Vende todo PEHUENCHE a 1200: realizada 20000 → posición 20000 / 100000; total (20000 + 5000) / 100000.
    const itau = row(byAccount.items, 'PEHUENCHE').accountId;
    await expectStatus(await ana.post('/trades', { accountId: itau, instrumentId: peh.id, side: 'SELL', tradeDate: '2025-06-01', quantity: '100', price: '1200' }), 201);
    const withClosed = await expectStatus(await ana.get(`/positions?includeClosed=true&asOf=${ASOF}`), 200);
    const closed = row(withClosed.items, 'PEHUENCHE');
    assert.deepEqual([closed.quantity, closed.realizedGain, closed.positionReturn, closed.totalReturn, closed.unrealizedReturn], ['0', '20000', '0.2', '0.25', null]);
    assert.equal(row(withClosed.items, 'KO').positionReturn, '0.155627');
  });

  test('CLP: invariante valor − costo = efecto precio + efecto cambiario por fila y en el total', async () => {
    const p = await expectStatus(await ana.get(`/positions?reportingCurrency=CLP&asOf=${ASOF}`), 200);
    const k = row(p.items, 'KO').reporting;
    assert.deepEqual([k.marketValue, k.costBasis, k.priceEffect, k.fxEffect, k.unrealizedGain], ['1058400', '872700', '144060', '41640', '185700']);
    assert.deepEqual([p.total.marketValue, p.total.priceEffect, p.total.fxEffect, p.total.unrealizedGain], ['1168400', '154060', '41640', '195700']);
    for (const r of [...p.items.map((i: { reporting: Record<string, string> }) => i.reporting), p.total]) assertInvariant(r);
  });

  test('USD: invariante también con redondeos de la conversión', async () => {
    const p = await expectStatus(await ana.get(`/positions?asOf=${ASOF}`), 200);
    const e = row(p.items, 'PEHUENCHE').reporting;
    assert.deepEqual([e.marketValue, e.costBasis, e.costBasisAtCurrentRate, e.priceEffect, e.fxEffect, e.unrealizedGain], ['112.2449', '111.1111', '102.0408', '10.2041', '-9.0703', '1.1338']);
    for (const r of [...p.items.map((i: { reporting: Record<string, string> }) => i.reporting), p.total]) assertInvariant(r);
  });

  test('sin precio: campos de mercado null, totales sólo con lo valorizado y cobertura parcial', async () => {
    await h.container.dataSource.query(`DELETE FROM price_quotes WHERE instrument_id = $1`, [peh.id]);
    const p = await expectStatus(await ana.get(`/positions?reportingCurrency=CLP&asOf=${ASOF}`), 200);
    const e = row(p.items, 'PEHUENCHE');
    assert.deepEqual([e.marketPrice, e.marketValue, e.totalReturn, e.positionReturn, e.reporting.marketValue, e.reporting.priceEffect], [null, null, null, null, null, null]);
    assert.equal(p.totalsByCurrency.find((t: { currency: string }) => t.currency === 'CLP').pricedCoverage, '0');
    assert.equal(p.total.marketValue, '1058400');
    const s = await expectStatus(await ana.get(`/portfolio/summary?reportingCurrency=CLP&asOf=${ASOF}`), 200);
    // Costo con precio 872700 / costo total 972700
    assert.equal(s.pricedCoverage, '0.897193');
  });
});

describe('resumen con patrimonio y ganancia total', () => {
  test('CLP', async () => {
    const s = await expectStatus(await ana.get(`/portfolio/summary?reportingCurrency=CLP&asOf=${ASOF}`), 200);
    assert.deepEqual(
      [s.marketValue, s.cash, s.netWorth, s.contributedCapital, s.totalGain, s.priceEffect, s.unrealizedGain, s.pricedCoverage, s.pricesAsOf, s.dividends.currentYield],
      ['1168400', '1252090', '2420490', '2000000', '420490', '154060', '195700', '1', '2025-10-01T19:00:00.000Z', '0.038166'],
    );
    assert.ok(d(s.unrealizedGain).eq(d(s.priceEffect).add(d(s.fxEffect.positions))));
  });

  test('USD', async () => {
    const s = await expectStatus(await ana.get(`/portfolio/summary?asOf=${ASOF}`), 200);
    assert.deepEqual(
      [s.marketValue, s.netWorth, s.totalGain, s.priceEffect, s.unrealizedGain, s.dividends.currentYield],
      ['1192.2449', '2469.8878', '247.6656', '157.2041', '148.1338', '0.038166'],
    );
  });
});

describe('serie histórica', () => {
  beforeEach(() =>
    h.container.uow.transaction((r) =>
      r.prices.saveProviderCloses(ko.id, [{ date: '2025-01-10', close: d('100') }, { date: '2025-06-30', close: d('115') }]),
    ),
  );

  test('diaria desde la primera operación; el último punto cuadra con el patrimonio del resumen; responde rápido', async () => {
    const started = performance.now();
    const res = await ana.get(`/portfolio/history?reportingCurrency=CLP&to=${ASOF}`);
    const elapsed = performance.now() - started;
    const hist = await expectStatus(res, 200);
    assert.ok(elapsed < 500, `tardó ${elapsed} ms`);
    assert.equal(hist.reportingCurrency, 'CLP');
    assert.equal(hist.items[0].date, '2025-01-10');
    assert.equal(hist.items.length, 265);
    const last = hist.items.at(-1);
    const s = await expectStatus(await ana.get(`/portfolio/summary?reportingCurrency=CLP&asOf=${ASOF}`), 200);
    assert.equal(last.date, ASOF);
    assert.equal(d(last.marketValue).add(d(last.cash)).toString(), s.netWorth);
    assert.deepEqual([last.netWorth, last.totalGain], [s.netWorth, s.totalGain]);
    assert.deepEqual(
      [last.costBasis, last.contributedCapital, last.dividendsNetCumulative, last.realizedGainCumulative],
      [s.costBasis, s.contributedCapital, s.dividends.netTotal, s.realizedGain],
    );
    // 10-ene: KO 10 × 100 USD × 900 = 900000; PEHUENCHE aún sin ningún precio → a su costo 100000 CLP.
    assert.deepEqual([hist.items[0].marketValue, hist.items[0].unpricedAtCost], ['1000000', '100000']);
    // Con la cotización del 1-oct ya todo tiene precio.
    assert.equal(last.unpricedAtCost, '0');
  });

  test('week y month: último día de cada periodo', async () => {
    const month = await expectStatus(await ana.get(`/portfolio/history?interval=month&from=2025-01-01&to=${ASOF}`), 200);
    assert.deepEqual(month.items.map((p: { date: string }) => p.date).slice(0, 2), ['2025-01-31', '2025-02-28']);
    assert.equal(month.items.at(-1).date, ASOF);
    const week = await expectStatus(await ana.get(`/portfolio/history?interval=week&from=2025-09-01&to=2025-09-15`), 200);
    assert.deepEqual(week.items.map((p: { date: string }) => p.date), ['2025-09-07', '2025-09-14', '2025-09-15']);
  });

  test('validación: rango invertido, demasiados puntos, intervalo', async () => {
    await expectStatus(await ana.get('/portfolio/history?from=2025-05-01&to=2025-01-01'), 400);
    await expectStatus(await ana.get('/portfolio/history?interval=day&from=2000-01-01&to=2025-01-01'), 400);
    await expectStatus(await ana.get('/portfolio/history?interval=year'), 400);
  });
});

describe('worker de precios con la fuente caída', () => {
  test('informa el error, no lanza y la API sigue respondiendo con lo guardado', async () => {
    const failing: MarketDataProvider = { fetchChart: async (s) => Promise.reject(new Error(`yahoo ${s}: HTTP 429`)) };
    const sync = new SyncPrices({ uow: h.container.uow, provider: failing, now: () => new Date('2025-10-01T15:00:00Z'), log: () => {}, pause: async () => {} });
    const report = await sync.backfill();
    assert.deepEqual(report.failures.map((f) => f.priceSymbol).sort(), ['KO', 'PEHUENCHE.SN']);
    const p = await expectStatus(await ana.get(`/positions?asOf=${ASOF}`), 200);
    assert.equal(row(p.items, 'KO').marketPrice, '120');
  });
});

describe('v0.5 — fechas de negocio del precio', () => {
  test('Quote.date, Position.priceDate y priceIsIntraday, Summary.pricesDate', async () => {
    const k = await expectStatus(await ana.get(`/instruments/${ko.id}`), 200);
    assert.equal(k.lastPrice.date, ASOF);
    const p = await expectStatus(await ana.get(`/positions?asOf=${ASOF}`), 200);
    // Cotización de una fecha pasada: no es intradía.
    assert.deepEqual([row(p.items, 'KO').priceDate, row(p.items, 'KO').priceIsIntraday], [ASOF, false]);
    const s = await expectStatus(await ana.get(`/portfolio/summary?asOf=${ASOF}`), 200);
    assert.equal(s.pricesDate, ASOF);
  });
});

describe('v0.5 — P2 meta de ingreso pasivo', () => {
  test('preferencias: por defecto sin meta; PATCH la define y null la elimina', async () => {
    assert.deepEqual(await expectStatus(await ana.get('/me/preferences'), 200), { reportingCurrency: 'USD', monthlyIncomeGoal: null, dividendCutThreshold: '0.1' });
    const set = await expectStatus(await ana.patch('/me/preferences', { monthlyIncomeGoal: { amount: '1000', currency: 'USD' } }), 200);
    assert.deepEqual(set, { reportingCurrency: 'USD', monthlyIncomeGoal: { amount: '1000', currency: 'USD' }, dividendCutThreshold: '0.1' });
    const both = await expectStatus(await ana.patch('/me/preferences', { reportingCurrency: 'CLP' }), 200);
    assert.deepEqual(both.monthlyIncomeGoal, { amount: '1000', currency: 'USD' }, 'cambiar la moneda de reporte no toca la meta');
    assert.equal((await expectStatus(await ana.patch('/me/preferences', { monthlyIncomeGoal: null }), 200)).monthlyIncomeGoal, null);
  });

  test('validación de la meta', async () => {
    for (const monthlyIncomeGoal of [{ amount: '0', currency: 'USD' }, { amount: '10', currency: 'ARS' }, { amount: 10, currency: 'USD' }, { amount: '10' }, '1000', { amount: '10', currency: 'USD', x: 1 }]) {
      const problem = await expectStatus(await ana.patch('/me/preferences', { monthlyIncomeGoal }), 400);
      assert.ok(problem.errors.some((e: { field: string }) => e.field.startsWith('monthlyIncomeGoal')), JSON.stringify(problem.errors));
    }
  });

  test('resumen: ingreso esperado neto y cobertura de la meta convertida a TC actual', async () => {
    let s = await expectStatus(await ana.get(`/portfolio/summary?reportingCurrency=CLP&asOf=${ASOF}`), 200);
    assert.equal(s.incomeGoal, null);
    // KO 9 × 2.04 × (1 − 0.15) = 15.606 USD × 980 = 15293.88; PEHUENCHE 100 × 266 × (1 − 0) = 26600
    assert.equal(s.dividends.expectedAnnualNet, '41893.88');

    await expectStatus(await ana.patch('/me/preferences', { monthlyIncomeGoal: { amount: '1000', currency: 'USD' } }), 200);
    s = await expectStatus(await ana.get(`/portfolio/summary?reportingCurrency=CLP&asOf=${ASOF}`), 200);
    // meta 1000 USD × 980 = 980000 CLP/mes; 12 meses: 13075 / (12 × 980000); esperado 41893.88 / (12 × 980000)
    assert.deepEqual(s.incomeGoal, {
      goal: { amount: '1000', currency: 'USD' },
      monthlyGoalReporting: '980000',
      coverageLast12Months: '0.001112',
      coverageExpected: '0.003562',
    });
    const usd = await expectStatus(await ana.get(`/portfolio/summary?asOf=${ASOF}`), 200);
    assert.deepEqual([usd.dividends.expectedAnnualNet, usd.incomeGoal.monthlyGoalReporting], ['42.7489', '1000']);
  });
});

describe('v0.5 — dividendos por mes', () => {
  test('meses en 0 incluidos, cada dividendo a TC de su fecha, años con retención y crecimiento YTD', async () => {
    const res = await expectStatus(await ana.get('/dividends/monthly?reportingCurrency=CLP&from=2025-03&to=2025-06'), 200);
    assert.equal(res.reportingCurrency, 'CLP');
    assert.deepEqual(res.months, [
      { month: '2025-03', paidNet: '0', paidGross: '0', announcedNet: '0', cumulativePaidNet: '0' },
      // KO: neto 8.5, bruto 10 USD a 950 (TC del 10-mar, último en o antes del 1-abr)
      { month: '2025-04', paidNet: '8075', paidGross: '9500', announcedNet: '0', cumulativePaidNet: '8075' },
      { month: '2025-05', paidNet: '5000', paidGross: '5000', announcedNet: '0', cumulativePaidNet: '13075' },
      { month: '2025-06', paidNet: '0', paidGross: '0', announcedNet: '0', cumulativePaidNet: '13075' },
    ]);
    const y2025 = res.years.find((y: { year: number }) => y.year === 2025);
    assert.deepEqual(y2025, { year: 2025, paidNet: '13075', paidGross: '14500', withholding: '1425', growth: null });
  });

  test('defaults: desde el mes del primer dividendo hasta el mes actual + 3', async () => {
    const res = await expectStatus(await ana.get('/dividends/monthly'), 200);
    assert.equal(res.months[0].month, '2025-04');
    const now = new Date();
    const plus3 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 3, 1)).toISOString().slice(0, 7);
    assert.equal(res.months.at(-1).month, plus3);
  });

  test('validación', async () => {
    for (const q of ['from=2025-13', 'to=2025-1', 'from=2025-06&to=2025-01', 'reportingCurrency=CLF']) {
      await expectStatus(await ana.get(`/dividends/monthly?${q}`), 400);
    }
  });
});

/** Fecha de negocio de hoy (Chile) desplazada `months` meses, en el día 15 (siempre válido). */
function monthShift(months: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
  const [y, m] = today.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + months, 15)).toISOString().slice(0, 10);
}

async function timed(path: string) {
  const started = performance.now();
  const body = await expectStatus(await ana.get(path), 200);
  return { body, ms: performance.now() - started };
}

describe('v0.5 — calendario de dividendos', () => {
  test('anunciados + estimados de 12 meses; un estimado no duplica un anunciado del mismo instrumento y mes', async () => {
    const ib = (await expectStatus(await ana.get('/accounts'), 200)).items.find((a: { name: string }) => a.name === 'IB');
    const itau = (await expectStatus(await ana.get('/accounts'), 200)).items.find((a: { name: string }) => a.name === 'Itaú');
    const post = async (body: object) => expectStatus(await ana.post('/dividends', { kind: 'REGULAR', ...body }), 201);
    // KO cobró hace 2 y hace 5 meses (9 acciones → 1 USD por acción); PEHUENCHE hace 1 mes (100 acciones → 10 CLP).
    await post({ accountId: ib.id, instrumentId: ko.id, status: 'PAID', paymentDate: monthShift(-2), grossAmount: '9' });
    await post({ accountId: ib.id, instrumentId: ko.id, status: 'PAID', paymentDate: monthShift(-5), grossAmount: '9' });
    await post({ accountId: itau.id, instrumentId: peh.id, status: 'PAID', kind: 'FINAL', paymentDate: monthShift(-1), grossAmount: '1000' });
    // Ya anunciado: KO en el mes del estimado de "hace 5 meses" (+12 = dentro de 7 meses).
    await post({ accountId: ib.id, instrumentId: ko.id, status: 'ANNOUNCED', paymentDate: monthShift(7), grossAmount: '10' });

    const { body: c, ms } = await timed('/dividends/calendar?reportingCurrency=CLP');
    assert.ok(ms < 300, `tardó ${ms} ms`);
    assert.equal(c.months.length, 12);
    assert.equal(c.months[0].month, monthShift(0).slice(0, 7));
    const month = (k: number) => c.months.find((m: { month: string }) => m.month === monthShift(k).slice(0, 7));

    // +10: estimado de KO = 1 USD × 9 × (1 − 0.15) = 7.65 USD × 980 = 7497 CLP
    assert.deepEqual(month(10).items.map((i: Record<string, string>) => [i.symbol, i.status, i.netAmount, i.netAmountReporting]), [['KO', 'ESTIMATED', '7.65', '7497']]);
    // +7: sólo el anunciado (8.5 USD neto), el estimado se descarta
    assert.deepEqual(month(7).items.map((i: Record<string, string>) => [i.symbol, i.status]), [['KO', 'ANNOUNCED']]);
    assert.deepEqual([month(7).announcedNet, month(7).estimatedNet], ['8330', '0']);
    // +11: PEHUENCHE 10 × 100 = 1000 CLP
    assert.deepEqual(month(11).items.map((i: Record<string, string>) => [i.symbol, i.netAmount, i.netAmountReporting]), [['PEHUENCHE', '1000', '1000']]);
    assert.equal(c.totalNet, '16827');
    assert.equal(
      c.months.reduce((acc: Decimal, m: { totalNet: string }) => acc.add(d(m.totalNet)), Decimal.ZERO).toString(),
      c.totalNet,
    );
  });
});

describe('v0.5 — distribución', () => {
  test('por moneda: valor a TC actual, pesos que suman 1, ingreso esperado y su peso', async () => {
    const { body: a, ms } = await timed('/portfolio/allocation?by=currency&reportingCurrency=CLP');
    assert.ok(ms < 300, `tardó ${ms} ms`);
    assert.deepEqual(a, {
      by: 'currency',
      reportingCurrency: 'CLP',
      total: '1168400',
      items: [
        { key: 'USD', label: 'USD', value: '1058400', weight: '0.905854', expectedAnnualIncomeGross: '17992.8', incomeWeight: '0.403491', valuedAtCost: '0' },
        { key: 'CLP', label: 'CLP', value: '110000', weight: '0.094146', expectedAnnualIncomeGross: '26600', incomeWeight: '0.596509', valuedAtCost: '0' },
      ],
    });
  });

  test('un instrumento sin precio va a su costo (a TC actual) y se marca', async () => {
    await h.container.dataSource.query(`DELETE FROM price_quotes WHERE instrument_id = $1`, [peh.id]);
    const a = await expectStatus(await ana.get('/portfolio/allocation?by=instrument&reportingCurrency=CLP'), 200);
    assert.deepEqual(a.items.map((i: Record<string, string>) => [i.label, i.value, i.weight, i.valuedAtCost]), [
      ['KO', '1058400', '0.913674', '0'],
      ['PEHUENCHE', '100000', '0.086326', '100000'],
    ]);
  });

  test('etiquetas por sector, mercado, cuenta y tipo; limit con "Otros (N)"', async () => {
    const label = async (by: string) => (await expectStatus(await ana.get(`/portfolio/allocation?by=${by}&reportingCurrency=CLP`), 200)).items.map((i: { label: string }) => i.label);
    assert.deepEqual(await label('sector'), ['Sin sector']);
    assert.deepEqual(await label('market'), ['Estados Unidos', 'Bolsa de Santiago']);
    assert.deepEqual(await label('account'), ['IB', 'Itaú']);
    assert.deepEqual(await label('type'), ['STOCK']);
    const limited = await expectStatus(await ana.get('/portfolio/allocation?by=instrument&limit=1&reportingCurrency=CLP'), 200);
    assert.deepEqual(limited.items.map((i: Record<string, string>) => [i.key, i.label, i.weight]), [[ko.id, 'KO', '0.905854'], ['__others', 'Otros (1)', '0.094146']]);
    for (const q of ['', 'by=broker', 'by=sector&limit=0', 'by=sector&limit=101']) {
      await expectStatus(await ana.get(`/portfolio/allocation?${q}`), 400);
    }
  });
});

describe('v0.6.2 — portfolioWeight', () => {
  const weights = (items: Array<Record<string, any>>) => items.map((i) => [i.symbol, i.accountId === null ? null : 'cuenta', i.portfolioWeight]);
  const allocationWeights = async () =>
    Object.fromEntries((await expectStatus(await ana.get('/portfolio/allocation?by=instrument&reportingCurrency=CLP'), 200)).items.map((i: Record<string, string>) => [i.label, i.weight]));
  const sum = (items: Array<{ portfolioWeight: string | null }>) => Decimal.sum(items.map((i) => d(i.portfolioWeight!)));

  test('dos monedas: pesos de la cartera en reporte que suman 1 y coinciden con /portfolio/allocation', async () => {
    // CLP: KO 1058400, PEHUENCHE 110000 → total 1168400
    const p = await expectStatus(await ana.get(`/positions?reportingCurrency=CLP&asOf=${ASOF}`), 200);
    assert.deepEqual(weights(p.items), [['PEHUENCHE', null, '0.094146'], ['KO', null, '0.905854']]);
    assert.ok(sum(p.items).sub(Decimal.ONE).abs().lte(d('0.000002')));
    assert.deepEqual(await allocationWeights(), { KO: '0.905854', PEHUENCHE: '0.094146' });
    // En USD los pesos son los mismos salvo redondeo de la conversión.
    const usd = await expectStatus(await ana.get(`/positions?asOf=${ASOF}`), 200);
    assert.ok(sum(usd.items).sub(Decimal.ONE).abs().lte(d('0.000002')));
  });

  test('una fila sin precio pesa por su costo, igual que la distribución', async () => {
    await h.container.dataSource.query(`DELETE FROM price_quotes WHERE instrument_id = $1`, [peh.id]);
    const p = await expectStatus(await ana.get(`/positions?reportingCurrency=CLP&asOf=${ASOF}`), 200);
    assert.deepEqual(weights(p.items), [['PEHUENCHE', null, '0.086326'], ['KO', null, '0.913674']]);
    assert.deepEqual(await allocationWeights(), { KO: '0.913674', PEHUENCHE: '0.086326' });
  });

  test('con filtro accountId el denominador sigue siendo la cartera completa', async () => {
    const all = await expectStatus(await ana.get(`/positions?groupBy=account&reportingCurrency=CLP&asOf=${ASOF}`), 200);
    const itau = row(all.items, 'PEHUENCHE').accountId;
    for (const groupBy of ['instrument', 'account']) {
      const p = await expectStatus(await ana.get(`/positions?accountId=${itau}&groupBy=${groupBy}&reportingCurrency=CLP&asOf=${ASOF}`), 200);
      assert.deepEqual(p.items.map((i: Record<string, string>) => [i.symbol, i.portfolioWeight]), [['PEHUENCHE', '0.094146']], groupBy);
      assert.ok(sum(p.items).lt(Decimal.ONE));
    }
  });

  test('groupBy=account: peso por fila; las filas de un instrumento suman su peso por instrumento', async () => {
    // KO también en Zesty (3 a 100 USD) y PEHUENCHE a 1568 → CLP: KO IB 9×120×980 = 1058400, KO Zesty 3×120×980 = 352800,
    // PEHUENCHE 156800; total 1568000 → 0.675, 0.225 y 0.1 (KO por instrumento 0.9)
    const zesty = await expectStatus(await ana.post('/accounts', { name: 'Zesty', broker: 'Zesty', baseCurrency: 'USD' }), 201);
    await expectStatus(await ana.post('/trades', { accountId: zesty.id, instrumentId: ko.id, side: 'BUY', tradeDate: '2025-09-01', quantity: '3', price: '100' }), 201);
    await quote(peh.id, '1568', null);
    const byAccount = await expectStatus(await ana.get(`/positions?groupBy=account&reportingCurrency=CLP&asOf=${ASOF}`), 200);
    const ko2 = byAccount.items.filter((i: { symbol: string }) => i.symbol === 'KO').map((i: { portfolioWeight: string }) => i.portfolioWeight).sort();
    assert.deepEqual(ko2, ['0.225', '0.675']);
    assert.equal(row(byAccount.items, 'PEHUENCHE').portfolioWeight, '0.1');
    assert.equal(sum(byAccount.items).toString(), '1');
    const byInstrument = await expectStatus(await ana.get(`/positions?reportingCurrency=CLP&asOf=${ASOF}`), 200);
    assert.deepEqual(weights(byInstrument.items), [['PEHUENCHE', null, '0.1'], ['KO', null, '0.9']]);
    assert.deepEqual(await allocationWeights(), { KO: '0.9', PEHUENCHE: '0.1' });
  });

  test('las posiciones cerradas dan null y no cuentan en el denominador', async () => {
    const all = await expectStatus(await ana.get(`/positions?groupBy=account&reportingCurrency=CLP&asOf=${ASOF}`), 200);
    const itau = row(all.items, 'PEHUENCHE').accountId;
    await expectStatus(await ana.post('/trades', { accountId: itau, instrumentId: peh.id, side: 'SELL', tradeDate: '2025-06-01', quantity: '100', price: '1200' }), 201);
    for (const groupBy of ['instrument', 'account']) {
      const p = await expectStatus(await ana.get(`/positions?includeClosed=true&groupBy=${groupBy}&reportingCurrency=CLP&asOf=${ASOF}`), 200);
      assert.deepEqual(p.items.map((i: Record<string, string>) => [i.symbol, i.quantity, i.portfolioWeight]), [['PEHUENCHE', '0', null], ['KO', '9', '1']], groupBy);
    }
  });
});

describe('v0.5 — P1 proyección bola de nieve', () => {
  test('defaults: aporte promedio de 12 meses sin el "Aporte no asignado" de la importación; yield neto actual', async () => {
    const ib = (await expectStatus(await ana.get('/accounts'), 200)).items.find((a: { name: string }) => a.name === 'IB');
    await expectStatus(await ana.post('/cash-movements', { accountId: ib.id, date: monthShift(-1), type: 'DEPOSIT', amount: '1200', currency: 'USD' }), 201);
    const { UNASSIGNED_IMPORT_DEPOSIT_DESCRIPTION } = await import('../../src/domain/cash-movement.ts');
    const userId = (await h.container.dataSource.query(`SELECT id FROM users WHERE email = 'ana@example.com'`))[0].id;
    await h.container.useCases.cash.create(
      userId,
      { accountId: ib.id, date: monthShift(-1), type: 'DEPOSIT', amount: d('5000'), currency: 'USD', description: UNASSIGNED_IMPORT_DEPOSIT_DESCRIPTION },
      'IMPORT',
      'UNASSIGNED_DEPOSIT',
    );
    // v0.6: se reconoce por importRole, no por el texto: un aporte inferido (IMPORT) sí cuenta como aporte.
    await h.container.useCases.cash.create(
      userId,
      { accountId: ib.id, date: monthShift(-1), type: 'DEPOSIT', amount: d('1200'), currency: 'USD', description: 'Texto cualquiera' },
      'IMPORT',
      'INFERRED_CONTRIBUTION',
    );
    const { body: p, ms } = await timed('/projections/snowball?reportingCurrency=CLP');
    assert.ok(ms < 300, `tardó ${ms} ms`);
    // (1200 + 1200) USD × 980 / 12 = 196000 CLP al mes; el depósito "no asignado" (importRole) no cuenta.
    assert.deepEqual(p.assumptions, {
      years: 20,
      monthlyContribution: '196000',
      contributionGrowth: '0',
      reinvestDividends: true,
      dividendGrowth: '0.05',
      priceGrowth: '0.04',
      startYield: '0.035856',
    });
    assert.equal(p.years.length, 20);
    assert.equal(p.start.annualDividendsNet, '41893.88');
    const currentYear = Number(monthShift(0).slice(0, 4));
    assert.equal(p.years[0].calendarYear, currentYear + 1);
    assert.equal(p.years[19].contributedCumulative, String(196000 * 240));
    const movements = (await expectStatus(await ana.get('/cash-movements?type=DEPOSIT'), 200)).items;
    assert.deepEqual(movements.map((m: { source: string; importRole: string | null }) => [m.source, m.importRole]).sort(), [
      ['IMPORT', 'INFERRED_CONTRIBUTION'], ['IMPORT', 'UNASSIGNED_DEPOSIT'], ['MANUAL', null], ['MANUAL', null], ['MANUAL', null],
    ].sort());
    assert.equal(p.goalReachedYear, null);
    assert.equal(p.years[0].goalCoverage, null);
  });

  test('parámetros explícitos y meta: sin aportes ni crecimiento ni reinversión el valor invertido queda constante', async () => {
    await expectStatus(await ana.patch('/me/preferences', { monthlyIncomeGoal: { amount: '1000', currency: 'USD' } }), 200);
    const p = await expectStatus(
      await ana.get('/projections/snowball?reportingCurrency=CLP&years=3&monthlyContribution=0&reinvestDividends=false&dividendGrowth=0&priceGrowth=0'),
      200,
    );
    const start = d(p.start.netWorth);
    for (const y of p.years) assert.equal(d(y.netWorth).sub(d(y.dividendsCumulative)).sub(start).abs().lte(d('0.0004')), true);
    assert.ok(p.years.every((y: { goalCoverage: string | null }) => y.goalCoverage !== null));
    assert.equal(p.goalReachedYear, null);
  });

  test('validación', async () => {
    for (const q of ['years=0', 'years=51', 'monthlyContribution=-1', 'priceGrowth=0.6', 'dividendGrowth=-0.51', 'contributionGrowth=1', 'reinvestDividends=si', 'monthlyContribution=1e3']) {
      await expectStatus(await ana.get(`/projections/snowball?${q}`), 400);
    }
  });
});

describe('v0.6 — preferencia de umbral de recorte', () => {
  test('default 0.1; PATCH 0 < x < 1; fuera de rango → 400', async () => {
    assert.equal((await expectStatus(await ana.patch('/me/preferences', { dividendCutThreshold: '0.25' }), 200)).dividendCutThreshold, '0.25');
    for (const dividendCutThreshold of ['0', '1', '-0.1', '1.5', 0.2]) {
      assert.equal((await expectStatus(await ana.patch('/me/preferences', { dividendCutThreshold }), 400)).errors[0].field, 'dividendCutThreshold');
    }
  });
});

describe('v0.6 — dividendo por acción y alertas', () => {
  // JNJ: 10 acciones hace 30 meses; TTM anterior 4 pagos de 1 por acción; TTM 1, 1, 1 y 0,85 (−3,75 % TTM, −15 % último regular).
  // KO y PEHUENCHE (del caso a mano) cobraron hace más de 12 meses y nada en los últimos 12 → SUSPENDED.
  let jnj: { id: string };
  beforeEach(async () => {
    const ib = (await expectStatus(await ana.get('/accounts'), 200)).items.find((a: { name: string }) => a.name === 'IB');
    jnj = await expectStatus(await ana.post('/instruments', { symbol: 'JNJ', marketCode: 'US', name: 'Johnson & Johnson', type: 'STOCK' }), 201);
    await expectStatus(await ana.post('/trades', { accountId: ib.id, instrumentId: jnj.id, side: 'BUY', tradeDate: monthShift(-30), quantity: '10', price: '150' }), 201);
    for (const [k, gross] of [[-23, '10'], [-20, '10'], [-17, '10'], [-14, '10'], [-11, '10'], [-8, '10'], [-5, '10'], [-2, '8.5']] as const) {
      await expectStatus(await ana.post('/dividends', { accountId: ib.id, instrumentId: jnj.id, status: 'PAID', kind: 'REGULAR', paymentDate: monthShift(k), grossAmount: gross }), 201);
    }
  });

  test('filas por instrumento abierto en su moneda, con estado y orden del contrato; responde rápido', async () => {
    const { body: r, ms } = await timed('/dividends/per-share');
    assert.ok(ms < 300, `tardó ${ms} ms`);
    assert.equal(r.cutThreshold, '0.1');
    assert.deepEqual(r.items.map((i: Record<string, string>) => [i.symbol, i.currency, i.status, i.cutReason, i.dataQuality]), [
      ['KO', 'USD', 'SUSPENDED', null, 'DERIVED'],
      ['PEHUENCHE', 'CLP', 'SUSPENDED', null, 'DERIVED'],
      ['JNJ', 'USD', 'CUT', 'LAST_REGULAR', 'DERIVED'],
    ]);
    const j = r.items.find((i: { symbol: string }) => i.symbol === 'JNJ');
    assert.deepEqual([j.ttmPerShare, j.previousTtmPerShare, j.ttmGrowth], ['3.85', '4', '-0.0375']);
    // Sin operaciones en los 45 días previos a cada pago: DPA derivado pero confiable.
    assert.deepEqual([j.lastRegular, j.previousRegular], [{ paymentDate: monthShift(-2), perShare: '0.85', estimated: false }, { paymentDate: monthShift(-5), perShare: '1', estimated: false }]);
    // KO: 10 USD brutos sobre 9 acciones al 1-abr-2025 → DPA derivado 1.1111111111; 2025 parcial (compra en enero).
    const k = r.items.find((i: { symbol: string }) => i.symbol === 'KO');
    assert.deepEqual(k.years[0], { year: 2025, perShare: '1.1111111111', growth: null, partial: true });
  });

  test('umbral por query y por preferencia; conteos del resumen', async () => {
    const q = await expectStatus(await ana.get('/dividends/per-share?cutThreshold=0.2'), 200);
    assert.equal(q.items.find((i: { symbol: string }) => i.symbol === 'JNJ').status, 'DOWN');
    assert.deepEqual((await expectStatus(await ana.get('/portfolio/summary'), 200)).dividendAlerts, { cut: 1, suspended: 2, down: 0 });
    await expectStatus(await ana.patch('/me/preferences', { dividendCutThreshold: '0.2' }), 200);
    assert.equal((await expectStatus(await ana.get('/dividends/per-share'), 200)).cutThreshold, '0.2');
    assert.deepEqual((await expectStatus(await ana.get('/portfolio/summary'), 200)).dividendAlerts, { cut: 0, suspended: 2, down: 1 });
    for (const t of ['0', '1', 'x']) await expectStatus(await ana.get(`/dividends/per-share?cutThreshold=${t}`), 400);
  });
});

describe('v0.6 — dividendos año contra año', () => {
  test('default: los 3 últimos años con datos (pueden ser menos de 3); moneda de reporte con conversión', async () => {
    const { body: r, ms } = await timed('/dividends/year-over-year?reportingCurrency=CLP');
    assert.ok(ms < 300, `tardó ${ms} ms`);
    // Sólo hay dividendos en 2025: un único bloque, sin años vacíos.
    assert.deepEqual([r.amountCurrency, r.converted, r.availableYears, r.years.map((y: { year: number }) => y.year)], ['CLP', true, [2025], [2025]]);
    const y2025 = r.years.find((y: { year: number }) => y.year === 2025);
    // abril: 8.5 USD × 950; mayo: 5000 CLP
    assert.deepEqual([y2025.months[3].paidNet, y2025.months[4].paidNet, y2025.totalPaidNet], ['8075', '5000', '13075']);
    assert.equal(y2025.months.length, 12);
  });

  test('currency filtra y no convierte; meses futuros del año en curso con ytd null', async () => {
    const year = Number(monthShift(0).slice(0, 4));
    const r = await expectStatus(await ana.get(`/dividends/year-over-year?years=2025,${year}&currency=USD`), 200);
    assert.deepEqual([r.amountCurrency, r.converted], ['USD', false]);
    const y2025 = r.years.find((y: { year: number }) => y.year === 2025);
    assert.deepEqual([y2025.months[3].paidNet, y2025.months[4].paidNet, y2025.totalPaidNet], ['8.5', '0', '8.5']);
    const current = r.years.find((y: { year: number }) => y.year === year);
    const month = Number(monthShift(0).slice(5, 7));
    if (month < 12) assert.equal(current.months[month].ytdPaidNet, null);
    assert.notEqual(current.months[month - 1].ytdPaidNet, null);
  });

  test('default con más de 3 años con datos: los 3 últimos; años explícitos se respetan aunque estén en 0', async () => {
    // Dividendos históricos de KO (antes de la posición): directo en BD, la API exigiría posición o cuenta vigente.
    await h.container.dataSource.query(
      `INSERT INTO dividends (user_id, account_id, instrument_id, status, kind, payment_date, currency, gross_amount, withholding_rate, withholding_amount, net_amount)
       SELECT user_id, account_id, instrument_id, 'PAID', 'REGULAR', d::date, currency, 1, 0, 0, 1
       FROM dividends, unnest(ARRAY['2021-03-01', '2022-03-01', '2023-03-01']) AS d WHERE payment_date = '2025-04-01'`,
    );
    const def = await expectStatus(await ana.get('/dividends/year-over-year?currency=USD'), 200);
    assert.deepEqual([def.availableYears, def.years.map((y: { year: number }) => y.year)], [[2021, 2022, 2023, 2025], [2022, 2023, 2025]]);
    const explicit = await expectStatus(await ana.get('/dividends/year-over-year?currency=USD&years=2024,2025'), 200);
    assert.deepEqual(explicit.years.map((y: { year: number; totalPaidNet: string }) => [y.year, y.totalPaidNet]), [[2024, '0'], [2025, '8.5']]);
  });

  test('validación: years mal formado o más de 6 → 400', async () => {
    for (const q of ['years=2025,', 'years=25', 'years=2020,2021,2022,2023,2024,2025,2026', 'currency=CLF', 'reportingCurrency=ARS']) {
      await expectStatus(await ana.get(`/dividends/year-over-year?${q}`), 400);
    }
  });
});
