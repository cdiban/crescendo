import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SyncReport } from '../../../src/application/use-cases/sync-fx.ts';
import { startFxSyncScheduler } from '../../../src/interfaces/worker/fx-sync-scheduler.ts';

const ok: SyncReport = { fetched: 1, changed: 1, failures: [] };

function fakeTimers() {
  const pending: Array<{ fn: () => void; ms: number }> = [];
  return {
    pending,
    timers: {
      setTimeout: (fn: () => void, ms: number) => {
        pending.push({ fn, ms });
        return pending.length;
      },
      clearTimeout: () => {
        pending.length = 0;
      },
    },
    async tick() {
      const next = pending.shift();
      assert.ok(next, 'no hay ciclo programado');
      next.fn();
      await new Promise((r) => setImmediate(r));
    },
  };
}

describe('startFxSyncScheduler', () => {
  test('primero backfill desde la fecha configurada; después refresh cada intervalo', async () => {
    const calls: string[] = [];
    const t = fakeTimers();
    const scheduler = startFxSyncScheduler({
      syncFx: { backfill: async (from) => (calls.push(`backfill ${from}`), ok), refresh: async () => (calls.push('refresh'), ok) },
      backfillFrom: '2024-01-01',
      intervalMs: 1000,
      log: () => {},
      timers: t.timers,
    });
    await scheduler.firstCycle;
    assert.deepEqual(calls, ['backfill 2024-01-01']);
    assert.equal(t.pending[0]?.ms, 1000);
    await t.tick();
    await t.tick();
    assert.deepEqual(calls, ['backfill 2024-01-01', 'refresh', 'refresh']);
    scheduler.stop();
    assert.equal(t.pending.length, 0);
  });

  test('si un ciclo lanza (fuente o BD caída), lo registra y sigue programando', async () => {
    const logs: string[] = [];
    const t = fakeTimers();
    let refreshes = 0;
    const scheduler = startFxSyncScheduler({
      syncFx: {
        backfill: async () => {
          throw new Error('BD caída');
        },
        refresh: async () => {
          refreshes += 1;
          if (refreshes === 1) throw new Error('mindicador caído');
          return { fetched: 0, changed: 0, failures: [{ currency: 'USD', year: 2026, error: 'timeout' }] };
        },
      },
      backfillFrom: '2024-01-01',
      intervalMs: 1000,
      log: (m) => logs.push(m),
      timers: t.timers,
    });
    await scheduler.firstCycle;
    await t.tick();
    await t.tick();
    assert.equal(refreshes, 2);
    assert.equal(t.pending.length, 1, 'sigue programado');
    assert.ok(logs.some((l) => l.includes('BD caída')));
    assert.ok(logs.some((l) => l.includes('mindicador caído')));
    scheduler.stop();
  });
});
