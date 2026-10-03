import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../src/domain/decimal.ts';
import type { FxQuote } from '../../src/domain/fx.ts';
import { expectStatus, startApi, type Api, type ApiHarness } from '../support/api-client.ts';

let h: ApiHarness;
let ana: Api;

export async function seedFx(harness: ApiHarness, quotes: Array<[FxQuote['currency'], string, string]>) {
  await harness.container.uow.transaction((r) =>
    r.fxRates.upsert(quotes.map(([currency, date, rate]) => ({ currency, date, rate: Decimal.parse(rate), source: `mindicador:${{ USD: 'dolar', EUR: 'euro', CLF: 'uf' }[currency]}` }))),
  );
}

before(async () => {
  h = await startApi();
});
after(() => h.close());
beforeEach(async () => {
  await h.reset();
  ana = await h.as('ana@example.com');
});

describe('preferencias', () => {
  test('moneda de reporte por defecto USD; PATCH la cambia', async () => {
    assert.deepEqual(await expectStatus(await ana.get('/me/preferences'), 200), { reportingCurrency: 'USD', monthlyIncomeGoal: null });
    assert.deepEqual(await expectStatus(await ana.patch('/me/preferences', { reportingCurrency: 'CLP' }), 200), { reportingCurrency: 'CLP', monthlyIncomeGoal: null });
    assert.deepEqual(await expectStatus(await ana.get('/me/preferences'), 200), { reportingCurrency: 'CLP', monthlyIncomeGoal: null });
    const beto = await h.as('beto@example.com');
    assert.deepEqual(await expectStatus(await beto.get('/me/preferences'), 200), { reportingCurrency: 'USD', monthlyIncomeGoal: null });
  });

  test('validación y autenticación', async () => {
    for (const body of [{}, { reportingCurrency: 'CLF' }, { reportingCurrency: 'usd' }, { reportingCurrency: 'USD', otro: 1 }]) {
      assert.equal((await expectStatus(await ana.patch('/me/preferences', body), 400)).code, 'VALIDATION_ERROR');
    }
    await expectStatus(await h.anonymous.get('/me/preferences'), 401);
    await expectStatus(await h.anonymous.patch('/me/preferences', { reportingCurrency: 'CLP' }), 401);
  });
});

describe('tipos de cambio', () => {
  beforeEach(() =>
    seedFx(h, [
      ['USD', '2025-01-02', '996.46'],
      ['USD', '2025-01-03', '990'],
      ['USD', '2025-01-06', '980'],
      ['EUR', '2025-01-03', '1030'],
      ['EUR', '2025-01-06', '1029'],
      ['CLF', '2025-01-04', '38500.5'],
    ]),
  );

  test('serie directa contra CLP, más antigua primero, con rango', async () => {
    const all = await expectStatus(await ana.get('/fx-rates?base=USD&quote=CLP'), 200);
    assert.deepEqual(all, {
      base: 'USD',
      quote: 'CLP',
      items: [
        { date: '2025-01-02', rate: '996.46' },
        { date: '2025-01-03', rate: '990' },
        { date: '2025-01-06', rate: '980' },
      ],
    });
    const range = await expectStatus(await ana.get('/fx-rates?base=USD&quote=CLP&from=2025-01-03&to=2025-01-05'), 200);
    assert.deepEqual(range.items.map((p: { date: string }) => p.date), ['2025-01-03']);
  });

  test('serie inversa y cruces derivados vía CLP (sólo fechas con dato de ambos lados)', async () => {
    const inverse = await expectStatus(await ana.get('/fx-rates?base=CLP&quote=USD&from=2025-01-06'), 200);
    assert.deepEqual(inverse.items, [{ date: '2025-01-06', rate: '0.0010204082' }]);
    const cross = await expectStatus(await ana.get('/fx-rates?base=EUR&quote=USD'), 200);
    assert.deepEqual(cross.items, [
      { date: '2025-01-03', rate: '1.0404040404' },
      { date: '2025-01-06', rate: '1.05' },
    ]);
  });

  test('validación: monedas desconocidas, iguales, faltantes, fechas', async () => {
    for (const q of ['base=USD', 'base=ARS&quote=CLP', 'base=USD&quote=USD', 'base=USD&quote=CLP&from=2025-13-01']) {
      assert.equal((await expectStatus(await ana.get(`/fx-rates?${q}`), 400)).code, 'VALIDATION_ERROR', q);
    }
    await expectStatus(await h.anonymous.get('/fx-rates?base=USD&quote=CLP'), 401);
  });

  test('latest: pares de referencia con su fecha y fuente', async () => {
    const { items } = await expectStatus(await ana.get('/fx-rates/latest'), 200);
    assert.deepEqual(items, [
      { base: 'USD', quote: 'CLP', date: '2025-01-06', rate: '980', source: 'mindicador:dolar' },
      { base: 'EUR', quote: 'CLP', date: '2025-01-06', rate: '1029', source: 'mindicador:euro' },
      { base: 'EUR', quote: 'USD', date: '2025-01-06', rate: '1.05', source: 'derived:CLP' },
      { base: 'CLF', quote: 'CLP', date: '2025-01-04', rate: '38500.5', source: 'mindicador:uf' },
    ]);
  });

  test('latest no usa datos con fecha posterior a hoy', async () => {
    await seedFx(h, [['USD', '2999-01-01', '1']]);
    const { items } = await expectStatus(await ana.get('/fx-rates/latest'), 200);
    assert.equal(items[0].date, '2025-01-06');
  });

  test('sin datos: latest vacío y serie vacía (no es error)', async () => {
    await h.reset();
    const api = await h.as('ana@example.com');
    assert.deepEqual((await expectStatus(await api.get('/fx-rates/latest'), 200)).items, []);
    assert.deepEqual((await expectStatus(await api.get('/fx-rates?base=USD&quote=CLP'), 200)).items, []);
  });
});
