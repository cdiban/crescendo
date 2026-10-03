import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FxQuote } from '../../src/domain/fx.ts';
import { SyncFx } from '../../src/application/use-cases/sync-fx.ts';
import { MindicadorFxRateProvider } from '../../src/infrastructure/fx/mindicador-fx-rate-provider.ts';
import { Decimal } from '../../src/domain/decimal.ts';
import { FixedClock } from '../support/in-memory.ts';
import { expectStatus, startApi, type ApiHarness } from '../support/api-client.ts';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'mindicador');

/** El adaptador real sobre respuestas grabadas: nunca sale a internet. */
function recordedProvider(down = new Set<string>()) {
  const fn = (async (input: string | URL | Request) => {
    const [, indicator, year] = /\/api\/(\w+)\/(\d+)$/.exec(String(input))!;
    if (down.has(`${indicator}/${year}`)) return new Response('Service Unavailable', { status: 503 });
    const file = { dolar: 'dolar-2025.json', euro: 'euro-2025.json', uf: 'uf-2026.json' }[indicator!]!;
    const body = JSON.parse(await readFile(join(FIXTURES, file), 'utf8'));
    // Las fixtures son de un año; para otros años no hay datos.
    return new Response(JSON.stringify(file.includes(year!) ? body : { ...body, serie: [] }));
  }) as typeof fetch;
  return new MindicadorFxRateProvider({ fetch: fn });
}

describe('sincronización de tipos de cambio (Postgres real, fuente grabada)', () => {
  let h: ApiHarness;
  before(async () => {
    h = await startApi();
  });
  after(() => h.close());
  beforeEach(() => h.reset());

  const sync = (down?: Set<string>) =>
    new SyncFx({ uow: h.container.uow, provider: recordedProvider(down), clock: new FixedClock(new Date('2026-10-03T15:00:00Z')), log: () => {} });
  const rows = async () => (await h.container.dataSource.query(`SELECT currency, date, rate::text, source, fetched_at FROM fx_rates ORDER BY currency, date`)) as Array<Record<string, unknown>>;

  test('backfill carga USD, EUR y CLF con fecha de Chile; correr de nuevo no cambia nada', async () => {
    const first = await sync().backfill('2025-01-01');
    assert.deepEqual(first.failures, []);
    assert.equal(first.changed, 17); // 10 USD + 3 EUR + 4 CLF
    const before = await rows();
    assert.ok(before.some((r) => r.currency === 'USD' && r.date === '2025-07-01' && r.rate === '933.4200000000'));
    assert.ok(before.some((r) => r.currency === 'CLF' && r.date === '2026-06-15' && r.source === 'mindicador:uf'));

    const second = await sync().backfill('2025-01-01');
    assert.equal(second.changed, 0);
    assert.deepEqual(await rows(), before, 'ni valores ni fetched_at cambian');
  });

  test('un valor corregido por la fuente se actualiza (upsert)', async () => {
    await sync().backfill('2025-01-01');
    const changed = await h.container.uow.transaction((r) =>
      r.fxRates.upsert([{ currency: 'USD' as FxQuote['currency'], date: '2025-07-01', rate: Decimal.parse('934'), source: 'mindicador:dolar' }]),
    );
    assert.equal(changed, 1);
    const [row] = await h.container.dataSource.query(`SELECT rate::text FROM fx_rates WHERE currency = 'USD' AND date = '2025-07-01'`);
    assert.equal(row.rate, '934.0000000000');
  });

  test('si la fuente cae, informa el error, guarda lo demás y la API sigue respondiendo', async () => {
    const report = await sync(new Set(['dolar/2025'])).backfill('2025-01-01');
    assert.deepEqual(report.failures.map((f) => `${f.currency} ${f.year}`), ['USD 2025']);
    assert.match(report.failures[0]!.error, /mindicador dolar\/2025: HTTP 503/);
    const api = await h.as('ana@example.com');
    const { items } = await expectStatus(await api.get('/fx-rates/latest'), 200);
    assert.deepEqual(items.map((i: { base: string; quote: string }) => `${i.base}/${i.quote}`), ['EUR/CLP', 'CLF/CLP']);
  });
});

