import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBundle } from '../../src/interfaces/cli/import-bundle-command.ts';
import { ImportRefusedError } from '../../src/application/use-cases/import-bundle.ts';
import { InsufficientPositionError } from '../../src/domain/errors.ts';
import { expectStatus, seedFlatUsd, startApi, type ApiHarness } from '../support/api-client.ts';

// Bundle sintético (nunca datos reales en los tests).
function bundle() {
  return {
    version: 1,
    cutoffDate: '2026-10-03',
    accounts: [
      { key: 'itau', name: 'Itaú Corredores', broker: 'Itaú', baseCurrency: 'CLP' },
      { key: 'ib', name: 'Interactive Brokers', broker: 'Interactive Brokers', baseCurrency: 'USD' },
    ],
    instruments: [
      { symbol: 'PEHUENCHE', marketCode: 'XSGO', name: 'PEHUENCHE', type: 'STOCK', sector: 'Energy', industry: 'Electric', annualDividendPerShare: '266' },
      { symbol: 'KO', marketCode: 'US', name: 'KO', type: 'STOCK', sector: 'Consumer', industry: 'Beverages', annualDividendPerShare: '2.04' },
    ],
    trades: [
      { accountKey: 'itau', symbol: 'PEHUENCHE', marketCode: 'XSGO', side: 'SELL', tradeDate: '2026-08-01', quantity: '15', price: '2700', commission: '0', commissionTax: '0', needsReview: true, notes: 'Venta importada al costo; revisar' },
      { accountKey: 'itau', symbol: 'PEHUENCHE', marketCode: 'XSGO', side: 'BUY', tradeDate: '2026-07-31', quantity: '115', price: '2600.1', commission: '748', commissionTax: '142.12', needsReview: false, notes: null },
      { accountKey: 'ib', symbol: 'KO', marketCode: 'US', side: 'BUY', tradeDate: '2025-01-10', quantity: '10', price: '50', commission: '1', commissionTax: '0', needsReview: false, notes: null },
    ],
    dividends: [
      { accountKey: 'itau', symbol: 'PEHUENCHE', marketCode: 'XSGO', status: 'PAID', kind: 'PROVISIONAL', paymentDate: '2026-08-20', grossAmount: '93178', withholdingRate: '0' },
      { accountKey: 'ib', symbol: 'KO', marketCode: 'US', status: 'PAID', kind: 'REGULAR', paymentDate: '2025-04-01', grossAmount: '20.02', withholdingRate: '0.15', netAmount: '17.017' },
      { accountKey: 'ib', symbol: 'KO', marketCode: 'US', status: 'ANNOUNCED', kind: 'REGULAR', paymentDate: '2026-12-15', grossAmount: '8.4', withholdingRate: '0.15', netAmount: '7.14' },
    ],
    cashMovements: [
      { accountKey: 'itau', date: '2026-07-31', type: 'DEPOSIT', amount: '299901.62', currency: 'CLP', description: 'Aporte inferido (importación)' },
      { accountKey: 'ib', date: '2025-01-10', type: 'DEPOSIT', amount: '501', currency: 'USD', description: 'Aporte inferido (importación)' },
      { accountKey: 'ib', date: '2026-10-03', type: 'ADJUSTMENT', amount: '-0.5', currency: 'USD', description: 'Ajuste al saldo del Excel (importación)' },
    ],
  };
}

describe('import-bundle (Postgres real)', () => {
  let h: ApiHarness;
  before(async () => {
    h = await startApi();
  });
  after(() => h.close());
  beforeEach(async () => {
    await h.reset();
    await seedFlatUsd(h);
  });

  const run = (email: string, b: unknown = bundle()) => h.container.useCases.importBundle.execute(email, parseBundle(b));

  test('carga todo con las reglas de la plataforma', async () => {
    const api = await h.as('import@example.com');
    const summary = await run('import@example.com');
    assert.deepEqual(summary, { accounts: 2, instrumentsCreated: 2, instrumentsReused: 0, trades: 3, dividends: 3, cashMovements: 3 });

    const accounts = (await expectStatus(await api.get('/accounts'), 200)).items;
    const balance = (name: string) => accounts.find((a: { name: string }) => a.name === name).cashBalances;
    // Itaú: +299901.62 − 299901.62 (compra) + 40500 (venta) + 93178 (dividendo)
    assert.deepEqual(balance('Itaú Corredores'), [{ amount: '133678', currency: 'CLP' }]);
    // IB: +501 − 501 (compra) + 17.017 (neto conservado) − 0.5
    assert.deepEqual(balance('Interactive Brokers'), [{ amount: '16.517', currency: 'USD' }]);

    const positions = (await expectStatus(await api.get('/positions?asOf=2026-10-03'), 200)).items;
    assert.deepEqual(positions.map((p: { symbol: string; quantity: string }) => [p.symbol, p.quantity]), [['PEHUENCHE', '100'], ['KO', '10']]);

    const review = await expectStatus(await api.get('/trades?needsReview=true'), 200);
    assert.equal(review.total, 1);

    const ko = (await expectStatus(await api.get('/dividends?status=PAID'), 200)).items.find((d: { symbol: string }) => d.symbol === 'KO');
    assert.deepEqual([ko.grossAmount, ko.withholdingRate, ko.withholdingAmount, ko.netAmount], ['20.02', '0.15', '3.003', '17.017']);

    const imported = (await expectStatus(await api.get('/cash-movements?type=DEPOSIT'), 200)).items;
    assert.ok(imported.every((m: { source: string }) => m.source === 'IMPORT'));
  });

  test('se niega si el usuario ya tiene cuentas, o si no existe', async () => {
    await h.as('import@example.com');
    await run('import@example.com');
    await assert.rejects(run('import@example.com'), ImportRefusedError);
    await assert.rejects(run('nadie@example.com'), ImportRefusedError);
  });

  test('si algo falla a mitad (posición negativa), no queda nada importado', async () => {
    const api = await h.as('import@example.com');
    const bad = bundle();
    bad.trades[0]!.quantity = '500';
    await assert.rejects(run('import@example.com', bad), InsufficientPositionError);
    assert.deepEqual((await expectStatus(await api.get('/accounts'), 200)).items, []);
    assert.equal((await expectStatus(await api.get('/instruments'), 200)).total, 0);
  });

  test('reutiliza instrumentos del catálogo y sólo completa campos vacíos', async () => {
    const other = await h.as('otro@example.com');
    const existing = await expectStatus(await other.post('/instruments', { symbol: 'KO', marketCode: 'US', name: 'Coca-Cola', type: 'STOCK', sector: 'Bebidas' }), 201);
    await h.as('import@example.com');
    const summary = await run('import@example.com');
    assert.deepEqual([summary.instrumentsCreated, summary.instrumentsReused], [1, 1]);
    const ko = await expectStatus(await other.get(`/instruments/${existing.id}`), 200);
    assert.deepEqual([ko.name, ko.sector, ko.industry, ko.annualDividendPerShare], ['Coca-Cola', 'Bebidas', 'Beverages', '2.04']);
  });
});
