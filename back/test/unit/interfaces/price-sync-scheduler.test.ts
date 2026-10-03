import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PriceSyncReport } from '../../../src/application/use-cases/sync-prices.ts';
import { startPriceSyncScheduler } from '../../../src/interfaces/worker/price-sync-scheduler.ts';

const ok: PriceSyncReport = { fetched: 1, closesChanged: 1, quotesSaved: 1, failures: [] };

describe('startPriceSyncScheduler', () => {
  test('cada ciclo: backfill, cotizaciones y consolidación; un paso que falla no impide los demás ni el siguiente ciclo', async () => {
    const calls: string[] = [];
    const pending: Array<() => void> = [];
    const logs: string[] = [];
    let backfills = 0;
    const scheduler = startPriceSyncScheduler({
      syncPrices: {
        backfill: async () => {
          calls.push('backfill');
          backfills += 1;
          if (backfills === 1) throw new Error('BD caída');
          return ok;
        },
        refreshQuotes: async () => (calls.push('quotes'), ok),
        consolidate: async () => (calls.push('consolidate'), { ...ok, failures: [{ instrumentId: 'x', priceSymbol: 'X', error: 'HTTP 429' }] }),
      },
      intervalMs: 300_000,
      log: (m) => logs.push(m),
      timers: { setTimeout: (fn: () => void) => pending.push(fn), clearTimeout: () => (pending.length = 0) },
    });
    await scheduler.firstCycle;
    assert.deepEqual(calls, ['backfill', 'quotes', 'consolidate']);
    assert.ok(logs.some((l) => l.includes('BD caída')));
    assert.ok(logs.some((l) => l.includes('1 errores')));
    assert.equal(pending.length, 1);
    pending.shift()!();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(calls.slice(3), ['backfill', 'quotes', 'consolidate']);
    scheduler.stop();
    assert.equal(pending.length, 0);
  });
});
