import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../src/domain/decimal.ts';
import { Portfolio } from '../../src/application/use-cases/portfolio.ts';
import { expectStatus, seedFlatUsd, startApi, type Api, type ApiHarness } from '../support/api-client.ts';
import { FixedClock } from '../support/in-memory.ts';

// Fase 6 — splits (contrato v0.7.0). Postgres real.
const d = Decimal.parse;
let h: ApiHarness;
let ana: Api;
let ib: { id: string };

before(async () => {
  h = await startApi();
});
after(() => h.close());
beforeEach(async () => {
  await h.reset();
  await seedFlatUsd(h);
  ana = await h.as('ana@example.com');
  ib = await expectStatus(await ana.post('/accounts', { name: 'IB', broker: 'IB', baseCurrency: 'USD' }), 201);
});

const post = async (api: Api, path: string, body: unknown, status = 201) => expectStatus(await api.post(path, body), status);
const instrument = (symbol: string, extra: object = {}) => post(ana, '/instruments', { symbol, marketCode: 'US', name: symbol, type: 'ETF', ...extra });
const trade = (api: Api, accountId: string, instrumentId: string, side: 'BUY' | 'SELL', tradeDate: string, quantity: string, price: string, status = 201) =>
  post(api, '/trades', { accountId, instrumentId, side, tradeDate, quantity, price }, status);
const position = async (instrumentId: string, asOf: string, reportingCurrency = 'USD') => {
  const body = await expectStatus(await ana.get(`/positions?asOf=${asOf}&reportingCurrency=${reportingCurrency}&includeClosed=true`), 200);
  return body.items.find((p: { instrumentId: string }) => p.instrumentId === instrumentId);
};

describe('POST/GET/DELETE /instruments/{id}/splits', () => {
  test('2:1 con compra antes y venta después: posición 5, costo 250, realizada 150; sin el split la venta da 422', async () => {
    const xyz = await instrument('XYZ', { annualDividendPerShare: '2' });
    await trade(ana, ib.id, xyz.id, 'BUY', '2025-05-02', '10', '100');
    assert.equal((await trade(ana, ib.id, xyz.id, 'SELL', '2025-07-01', '15', '60', 422)).code, 'INSUFFICIENT_POSITION');

    const split = await post(ana, `/instruments/${xyz.id}/splits`, { effectiveDate: '2025-06-02', numerator: 2, denominator: 1 });
    assert.deepEqual(Object.keys(split).sort(), ['createdAt', 'denominator', 'effectiveDate', 'id', 'instrumentId', 'numerator']);
    assert.deepEqual([split.instrumentId, split.effectiveDate, split.numerator, split.denominator], [xyz.id, '2025-06-02', 2, 1]);

    await trade(ana, ib.id, xyz.id, 'SELL', '2025-07-01', '15', '60');
    const p = await position(xyz.id, '2025-12-31');
    assert.deepEqual([p.quantity, p.costBasis, p.realizedGain, p.averageCost], ['5', '250', '150', '50']);
    // annualDividendPerShare pasó a acciones nuevas.
    assert.equal(p.annualDividendPerShare, '1');

    // Borrar el split deja la venta sin respaldo.
    const del = await expectStatus(await ana.delete(`/instruments/${xyz.id}/splits/${split.id}`), 422);
    assert.equal(del.code, 'INSUFFICIENT_POSITION');
    // Las operaciones se muestran tal como se ejecutaron.
    const trades = await expectStatus(await ana.get(`/trades?instrumentId=${xyz.id}`), 200);
    assert.deepEqual(trades.items.map((t: { quantity: string }) => t.quantity).sort(), ['10', '15']);
  });

  test('reverse split con ventas posteriores mayores que la mitad (de otro usuario) → 422 con detalle genérico', async () => {
    const xyz = await instrument('XYZ');
    await trade(ana, ib.id, xyz.id, 'BUY', '2025-01-10', '10', '10');
    const beto = await h.as('beto@example.com');
    const acc = await post(beto, '/accounts', { name: 'Zesty', broker: 'Zesty', baseCurrency: 'USD' });
    await trade(beto, acc.id, xyz.id, 'BUY', '2025-01-10', '10', '10');
    await trade(beto, acc.id, xyz.id, 'SELL', '2025-08-01', '6', '20');

    const res = await post(ana, `/instruments/${xyz.id}/splits`, { effectiveDate: '2025-06-02', numerator: 1, denominator: 2 }, 422);
    assert.equal(res.code, 'INSUFFICIENT_POSITION');
    assert.doesNotMatch(res.detail, /\d{4}-\d{2}-\d{2}/, 'no revela fechas de otros usuarios');
    assert.deepEqual((await expectStatus(await ana.get(`/instruments/${xyz.id}/splits`), 200)).items, []);
  });

  test('annualDividendPerShare se ajusta al crear (÷ factor) y se revierte al borrar (× factor); el dividendo con perShare usa las acciones de su fecha', async () => {
    const bito = await instrument('BITO', { annualDividendPerShare: '0.1371' });
    await trade(ana, ib.id, bito.id, 'BUY', '2026-01-06', '331.794', '20');
    const split = await post(ana, `/instruments/${bito.id}/splits`, { effectiveDate: '2026-11-19', numerator: 1, denominator: 2 });
    assert.equal((await expectStatus(await ana.get(`/instruments/${bito.id}`), 200)).annualDividendPerShare, '0.2742');

    // perShare sin quantity: después del split cuenta 165.897 acciones; antes, 331.794.
    const dividend = (paymentDate: string) =>
      post(ana, '/dividends', { accountId: ib.id, instrumentId: bito.id, status: 'ANNOUNCED', kind: 'REGULAR', paymentDate, perShare: '0.02' });
    assert.deepEqual([(await dividend('2026-11-20')).quantity, (await dividend('2026-11-18')).quantity], ['165.897', '331.794']);

    await expectStatus(await ana.delete(`/instruments/${bito.id}/splits/${split.id}`), 204);
    assert.equal((await expectStatus(await ana.get(`/instruments/${bito.id}`), 200)).annualDividendPerShare, '0.1371');
  });

  test('errores: 409 fecha duplicada, 400 fecha futura / numerator = denominator / fuera de rango, 404 split de otro instrumento', async () => {
    const xyz = await instrument('XYZ');
    const abc = await instrument('ABC');
    const path = `/instruments/${xyz.id}/splits`;
    const first = await post(ana, path, { effectiveDate: '2025-06-02', numerator: 3, denominator: 2 });
    await post(ana, path, { effectiveDate: '2024-01-02', numerator: 1, denominator: 10 });
    assert.equal((await post(ana, path, { effectiveDate: '2025-06-02', numerator: 2, denominator: 1 }, 409)).code, 'CONFLICT');

    const fields = async (body: unknown) => (await post(ana, path, body, 400)).errors.map((e: { field: string }) => e.field);
    assert.deepEqual(await fields({ effectiveDate: '2099-01-02', numerator: 2, denominator: 1 }), ['effectiveDate']);
    assert.deepEqual(await fields({ effectiveDate: '2025-01-02', numerator: 2, denominator: 2 }), ['denominator']);
    assert.deepEqual(await fields({ effectiveDate: '2025-01-02', numerator: 0, denominator: 1001 }), ['numerator', 'denominator']);
    assert.deepEqual(await fields({ effectiveDate: '2025-01-02', numerator: 2, denominator: 1, extra: 1 }), ['extra']);

    await expectStatus(await ana.delete(`/instruments/${abc.id}/splits/${first.id}`), 404);
    await expectStatus(await ana.delete(`/instruments/${xyz.id}/splits/no-es-uuid`), 404);
    await expectStatus(await ana.get(`/instruments/00000000-0000-4000-8000-000000000000/splits`), 404);

    // Más reciente primero.
    const list = await expectStatus(await ana.get(path), 200);
    assert.deepEqual(list.items.map((s: { effectiveDate: string }) => s.effectiveDate), ['2025-06-02', '2024-01-02']);
    await expectStatus(await ana.delete(`${path}/${first.id}`), 204);
    await expectStatus(await ana.delete(`${path}/${first.id}`), 404);
  });
});

describe('caso BITO: reverse split 1 por 2 del 2026-11-19', () => {
  let bito: { id: string };
  const clock = new FixedClock(new Date('2026-11-19T21:00:00Z'));
  const portfolio = () => new Portfolio({ uow: h.container.uow, clock });
  const MONTHS = ['02', '03', '04', '05', '06', '07', '08', '09', '10', '11'];

  beforeEach(async () => {
    bito = await instrument('BITO', { annualDividendPerShare: '0.1371' });
    await trade(ana, ib.id, bito.id, 'BUY', '2026-01-06', '200', '20');
    await trade(ana, ib.id, bito.id, 'BUY', '2026-02-11', '131.794', '20');
    // Dividendos sin perShare (como la importación): 0.0114 por acción sobre 331.794.
    for (const m of MONTHS) {
      await post(ana, '/dividends', { accountId: ib.id, instrumentId: bito.id, status: 'PAID', kind: 'REGULAR', paymentDate: `2026-${m}-12`, grossAmount: '3.7825' });
    }
    // Precios reales (Yahoo aún sin ajustar): 8.25 y 8.31 antes del split; 16.72 el día del split.
    await h.container.uow.transaction(async (r) => {
      await r.prices.saveProviderCloses(bito.id, [{ date: '2026-11-17', close: d('8.25') }, { date: '2026-11-18', close: d('8.31') }]);
      await r.prices.saveProviderQuote(bito.id, { price: d('16.72'), previousClose: d('8.31'), asOf: new Date('2026-11-19T21:00:00Z'), date: '2026-11-19' });
    });
  });

  const registerSplit = () => post(ana, `/instruments/${bito.id}/splits`, { effectiveDate: '2026-11-19', numerator: 1, denominator: 2 });
  const history = async () =>
    (await expectStatus(await ana.get('/portfolio/history?from=2026-11-17&to=2026-11-19&interval=day&reportingCurrency=USD'), 200)).items.map(
      (p: { date: string; marketValue: string }) => [p.date, p.marketValue],
    );

  test('cantidad, costo, variación del día e historial continuo', async () => {
    const before = await position(bito.id, '2026-11-19');
    await registerSplit();
    const p = await position(bito.id, '2026-11-19');
    assert.deepEqual([p.quantity, p.costBasis, p.averageCost, p.annualDividendPerShare], ['165.897', before.costBasis, '40', '0.2742']);
    // 16.72 frente a 8.31 × 2, no +101 %.
    assert.equal(p.dayChange, '0.006017');
    assert.equal(p.marketValue, '2773.7978');

    // El 18 se calcula como 331.794 × 8.31; el 19 sólo se mueve con el precio.
    assert.deepEqual(await history(), [['2026-11-17', '2737.3005'], ['2026-11-18', '2757.2081'], ['2026-11-19', '2773.7978']]);
    // Sin precio el día del split: el cierre del 18 arrastrado y normalizado (8.31 × 2) → mismo valor que el 18.
    await h.container.dataSource.query('DELETE FROM price_quotes WHERE instrument_id = $1', [bito.id]);
    assert.deepEqual((await history()).at(-1), ['2026-11-19', '2757.2081']);
    assert.equal((await position(bito.id, '2026-11-19')).marketPrice, '16.62');
    // Con cierre ese día: precio real del día.
    await h.container.uow.transaction((r) => r.prices.saveProviderCloses(bito.id, [{ date: '2026-11-19', close: d('16.72') }]));
    assert.deepEqual((await history()).at(-1), ['2026-11-19', '2773.7978']);
  });

  test('DPA × 2 sin CUT por el split y calendario con el mismo ingreso proyectado', async () => {
    const dpsBefore = (await portfolio().dividendsPerShare((await userId()), {})).items[0]!;
    const calendarBefore = await portfolio().dividendCalendar(await userId(), { reportingCurrency: 'USD' });
    await registerSplit();
    const dpsAfter = (await portfolio().dividendsPerShare(await userId(), {})).items[0]!;
    const calendarAfter = await portfolio().dividendCalendar(await userId(), { reportingCurrency: 'USD' });

    assert.equal(dpsAfter.lastRegular!.perShare.toString(), dpsBefore.lastRegular!.perShare.mul(d('2')).toString());
    assert.equal(dpsAfter.ttmPerShare.toString(), dpsBefore.ttmPerShare.mul(d('2')).toString());
    assert.equal(dpsAfter.status, dpsBefore.status);
    assert.notEqual(dpsAfter.status, 'CUT');
    assert.equal(calendarAfter.totalNet.toString(), calendarBefore.totalNet.toString());
    assert.ok(calendarAfter.totalNet.isPositive());
  });

  async function userId(): Promise<string> {
    const [row] = await h.container.dataSource.query(`SELECT id FROM users WHERE email = 'ana@example.com'`);
    return row.id;
  }
});
