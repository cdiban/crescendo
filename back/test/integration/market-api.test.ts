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
    assert.deepEqual(k.lastPrice, { price: '120', currency: 'USD', asOf: '2025-10-01T19:00:00.000Z', source: 'PROVIDER', previousClose: '118' });
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
    assert.deepEqual(
      p.totalsByCurrency.map((t: Record<string, string>) => [t.currency, t.marketValue, t.unrealizedGain, t.pricedCoverage]),
      [['CLP', '110000', '10000', '1'], ['USD', '1080', '147', '1']],
    );
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
    assert.deepEqual([e.marketPrice, e.marketValue, e.totalReturn, e.reporting.marketValue, e.reporting.priceEffect], [null, null, null, null, null]);
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
