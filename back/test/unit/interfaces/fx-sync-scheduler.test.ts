import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SyncReport } from '../../../src/application/use-cases/sync-fx.ts';
import { FX_TICK_MS, startFxSyncScheduler } from '../../../src/interfaces/worker/fx-sync-scheduler.ts';

const HOUR = 3_600_000;
const INTERVAL = 6 * HOUR;
const ok: SyncReport = { fetched: 1, changed: 1, failures: [] };
const partial: SyncReport = { fetched: 0, changed: 0, failures: [{ currency: 'USD', year: 2026, error: 'timeout' }] };

/** Timers falsos + reloj real inyectado: cada tick avanza el reloj lo que dura el timer. */
function fakeTimers() {
  const pending: Array<{ fn: () => void; ms: number }> = [];
  const clock = { now: 1_000_000 };
  return {
    pending,
    clock,
    now: () => clock.now,
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
      assert.ok(next, 'no hay tick programado');
      clock.now += next.ms;
      next.fn();
      await new Promise((r) => setImmediate(r));
    },
  };
}

function setup(refresh: () => Promise<SyncReport>, backfill: (from: string) => Promise<SyncReport> = async () => ok) {
  const t = fakeTimers();
  const logs: string[] = [];
  const scheduler = startFxSyncScheduler({
    syncFx: { backfill, refresh },
    backfillFrom: '2024-01-01',
    intervalMs: INTERVAL,
    log: (m) => logs.push(m),
    timers: t.timers,
    now: t.now,
  });
  return { t, logs, scheduler };
}

describe('startFxSyncScheduler', () => {
  test('backfill al iniciar y después revisa cada 15 min', async () => {
    const calls: string[] = [];
    const { t, scheduler } = setup(
      async () => (calls.push('refresh'), ok),
      async (from) => (calls.push(`backfill ${from}`), ok),
    );
    await scheduler.firstCycle;
    assert.deepEqual(calls, ['backfill 2024-01-01']);
    assert.equal(FX_TICK_MS, 15 * 60_000);
    assert.equal(t.pending[0]?.ms, FX_TICK_MS);
    scheduler.stop();
  });

  test('tras una carga exitosa no recarga antes de intervalMs de hora real, aunque pasen ticks; ni lo registra', async () => {
    let refreshes = 0;
    const { t, logs, scheduler } = setup(async () => (refreshes++, ok));
    await scheduler.firstCycle;
    const logsAfterBackfill = logs.length;
    const ticksBeforeDue = INTERVAL / FX_TICK_MS - 1;
    for (let i = 0; i < ticksBeforeDue; i++) await t.tick();
    assert.equal(refreshes, 0);
    assert.equal(logs.length, logsAfterBackfill, 'los ticks sin trabajo no se registran');
    await t.tick(); // se cumple intervalMs
    assert.equal(refreshes, 1);
    await t.tick();
    assert.equal(refreshes, 1, 'el intervalo vuelve a contar desde la última carga exitosa');
    scheduler.stop();
  });

  test('un fallo (excepción) se reintenta en el siguiente tick y no detiene el ciclo', async () => {
    let refreshes = 0;
    const { t, logs, scheduler } = setup(
      async () => {
        refreshes++;
        if (refreshes === 1) throw new Error('mindicador caído');
        return ok;
      },
      async () => {
        throw new Error('BD caída');
      },
    );
    await scheduler.firstCycle;
    assert.ok(logs.some((l) => l.includes('BD caída')));
    await t.tick();
    assert.equal(refreshes, 1, 'backfill fallido → reintento en el primer tick');
    assert.ok(logs.some((l) => l.includes('mindicador caído')));
    await t.tick();
    assert.equal(refreshes, 2, 'refresh fallido → reintento en el siguiente tick');
    await t.tick();
    assert.equal(refreshes, 2, 'ya cargó bien: espera intervalMs');
    assert.equal(t.pending.length, 1, 'sigue programado');
    scheduler.stop();
  });

  test('un refresh con failures parciales también se reintenta en el siguiente tick', async () => {
    const reports = [partial, partial, ok];
    let refreshes = 0;
    const { t, scheduler } = setup(async () => reports[refreshes++] ?? ok, async () => partial);
    await scheduler.firstCycle;
    await t.tick();
    await t.tick();
    await t.tick();
    assert.equal(refreshes, 3);
    await t.tick();
    assert.equal(refreshes, 3);
    scheduler.stop();
  });

  test('si la hora real salta más allá de intervalMs (suspensión), el siguiente tick recarga', async () => {
    let refreshes = 0;
    const { t, scheduler } = setup(async () => (refreshes++, ok));
    await scheduler.firstCycle;
    await t.tick();
    assert.equal(refreshes, 0);
    t.clock.now += 18 * HOUR; // el Mac durmió: el timer no avanzó pero la hora real sí
    await t.tick();
    assert.equal(refreshes, 1);
    scheduler.stop();
  });

  test('stop() detiene los ticks, también si llega durante un refresh en curso', async () => {
    let release!: () => void;
    const { t, scheduler } = setup(
      () => new Promise<SyncReport>((r) => (release = () => r(ok))),
      async () => partial,
    );
    await scheduler.firstCycle;
    await t.tick(); // refresh en curso
    scheduler.stop();
    release();
    await new Promise((r) => setImmediate(r));
    assert.equal(t.pending.length, 0);
  });
});
