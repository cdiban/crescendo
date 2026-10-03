import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runSyncFx } from '../../../src/interfaces/cli/sync-fx-command.ts';

describe('CLI sync-fx', () => {
  const run = (argv: string[], failures: Array<{ currency: 'USD'; year: number; error: string }> = []) => {
    const out: string[] = [];
    const err: string[] = [];
    const calls: string[] = [];
    const code = runSyncFx({
      argv,
      syncFx: { backfill: async (from) => (calls.push(from), { fetched: 10, changed: 3, failures }) },
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    });
    return { code, out, err, calls };
  };

  test('--from obligatorio y válido → backfill desde esa fecha', async () => {
    const r = run(['--from', '2024-01-01']);
    assert.equal(await r.code, 0);
    assert.deepEqual(r.calls, ['2024-01-01']);
    assert.match(r.out.join(''), /3 nuevos/);
  });

  test('uso incorrecto → 2 sin llamar', async () => {
    for (const argv of [[], ['--from', '2024-02-30'], ['--desde', '2024-01-01']]) {
      const r = run(argv);
      assert.equal(await r.code, 2);
      assert.deepEqual(r.calls, []);
    }
  });

  test('errores de la fuente → código 1 y detalle', async () => {
    const r = run(['--from', '2024-01-01'], [{ currency: 'USD', year: 2025, error: 'timeout' }]);
    assert.equal(await r.code, 1);
    assert.match(r.err.join(''), /USD 2025: timeout/);
  });
});
