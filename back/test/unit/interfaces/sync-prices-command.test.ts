import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runSyncPrices } from '../../../src/interfaces/cli/sync-prices-command.ts';

describe('CLI sync-prices', () => {
  const run = async (argv: string[], failures: Array<{ instrumentId: string; priceSymbol: string; error: string }> = []) => {
    const calls: unknown[] = [];
    const err: string[] = [];
    const code = await runSyncPrices({
      argv,
      syncPrices: { syncAll: async (o) => (calls.push(o), { fetched: 5, closesChanged: 2, quotesSaved: 1, failures }) },
      stdout: () => {},
      stderr: (s) => err.push(s),
    });
    return { code, calls, err };
  };

  test('sin opciones: todo; con --from y --symbol', async () => {
    assert.deepEqual((await run([])).calls, [{ from: undefined, symbol: undefined }]);
    assert.deepEqual((await run(['--from', '2024-01-01', '--symbol', 'KO'])).calls, [{ from: '2024-01-01', symbol: 'KO' }]);
  });

  test('uso incorrecto → 2', async () => {
    assert.equal((await run(['--from', '2024-13-01'])).code, 2);
    assert.equal((await run(['--otro'])).code, 2);
  });

  test('errores de la fuente → 1', async () => {
    const r = await run([], [{ instrumentId: 'x', priceSymbol: 'KO', error: 'HTTP 429' }]);
    assert.equal(r.code, 1);
    assert.match(r.err.join(''), /KO: HTTP 429/);
  });
});
