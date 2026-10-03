import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../../../src/domain/decimal.ts';
import type { FxQuote } from '../../../src/domain/fx.ts';
import type { FetchedFxQuote, FxRateProvider } from '../../../src/application/ports/fx-rate-provider.ts';
import { SyncFx } from '../../../src/application/use-cases/sync-fx.ts';
import { FixedClock, InMemoryFxRateRepository, inMemoryUnitOfWork } from '../../support/in-memory.ts';

class FakeProvider implements FxRateProvider {
  readonly calls: string[] = [];
  readonly failing = new Set<string>();

  async fetchYear(currency: FxQuote['currency'], year: number): Promise<FetchedFxQuote[]> {
    const key = `${currency}-${year}`;
    this.calls.push(key);
    if (this.failing.has(key)) throw new Error(`mindicador caído (${key})`);
    const last = year === 2026 ? '10-02' : '12-30';
    return ['01-02', '06-15', last].map((md) => ({ currency, date: `${year}-${md}`, rate: Decimal.parse('900.5'), source: 'fake' }));
  }
}

function setup() {
  const fxRates = new InMemoryFxRateRepository();
  const provider = new FakeProvider();
  const logs: string[] = [];
  const sync = new SyncFx({ uow: inMemoryUnitOfWork({ fxRates }), provider, clock: new FixedClock(new Date('2026-10-03T15:00:00Z')), log: (m) => logs.push(m) });
  return { fxRates, provider, sync, logs };
}

describe('SyncFx', () => {
  test('backfill trae cada año faltante de USD, EUR y CLF hasta el año en curso', async () => {
    const { provider, sync, fxRates } = setup();
    const report = await sync.backfill('2024-01-01');
    assert.deepEqual(provider.calls.sort(), ['CLF-2024', 'CLF-2025', 'CLF-2026', 'EUR-2024', 'EUR-2025', 'EUR-2026', 'USD-2024', 'USD-2025', 'USD-2026']);
    assert.equal(fxRates.rows.size, 27);
    assert.equal(report.changed, 27);
    assert.deepEqual(report.failures, []);
  });

  test('una segunda corrida sólo refresca el año en curso y no cambia nada', async () => {
    const { provider, sync } = setup();
    await sync.backfill('2024-01-01');
    provider.calls.length = 0;
    const again = await sync.backfill('2024-01-01');
    assert.deepEqual(provider.calls.sort(), ['CLF-2026', 'EUR-2026', 'USD-2026']);
    assert.equal(again.changed, 0);
  });

  test('un año pasado incompleto (sin fin de diciembre) se vuelve a pedir', async () => {
    const { provider, sync, fxRates } = setup();
    await fxRates.upsert([{ currency: 'USD', date: '2025-06-15', rate: Decimal.parse('950'), source: 'fake' }]);
    await sync.backfill('2025-01-01');
    assert.ok(provider.calls.includes('USD-2025'));
  });

  test('los errores de la fuente se informan y no detienen el resto', async () => {
    const { provider, sync, fxRates, logs } = setup();
    provider.failing.add('EUR-2025');
    const report = await sync.backfill('2025-01-01');
    assert.deepEqual(report.failures.map((f) => `${f.currency}-${f.year}`), ['EUR-2025']);
    assert.match(report.failures[0]!.error, /caído/);
    assert.equal(fxRates.rows.size, 15);
    assert.ok(logs.some((l) => l.includes('EUR-2025') || (l.includes('EUR') && l.includes('2025'))));
  });

  test('refresh pide sólo el año en curso', async () => {
    const { provider, sync } = setup();
    await sync.refresh();
    assert.deepEqual(provider.calls.sort(), ['CLF-2026', 'EUR-2026', 'USD-2026']);
  });
});
