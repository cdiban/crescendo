import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MindicadorFxRateProvider } from '../../../src/infrastructure/fx/mindicador-fx-rate-provider.ts';

// Respuestas reales de mindicador.cl grabadas (recortadas); los tests nunca llaman a internet.
const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'mindicador');
const fixture = (name: string) => readFile(join(FIXTURES, name), 'utf8');

function fakeFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(String(input));
    return handler(String(input), init);
  }) as typeof fetch;
  return { fn, calls };
}

describe('MindicadorFxRateProvider', () => {
  test('pide la serie anual del indicador y convierte a fecha de Chile', async () => {
    const { fn, calls } = fakeFetch(async () => new Response(await fixture('dolar-2025.json'), { status: 200 }));
    const quotes = await new MindicadorFxRateProvider({ fetch: fn }).fetchYear('USD', 2025);

    assert.deepEqual(calls, ['https://mindicador.cl/api/dolar/2025']);
    const byDate = new Map(quotes.map((q) => [q.date, q]));
    // Verano: 2025-12-30T03:00:00.000Z es la medianoche del 30 en Chile.
    assert.equal(byDate.get('2025-12-30')?.rate.toString(), '911.18');
    // Invierno: 2025-07-01T04:00:00.000Z es la medianoche del 1 en Chile (no "corta" al día 1 por azar).
    assert.equal(byDate.get('2025-07-01')?.rate.toString(), '933.42');
    // Cambio de horario (6-abr-2025): T03 el viernes 4 y T04 el lunes 7.
    assert.equal(byDate.get('2025-04-04')?.rate.toString(), '946.59');
    assert.equal(byDate.get('2025-04-07')?.rate.toString(), '975.82');
    assert.ok(quotes.every((q) => q.currency === 'USD' && q.source === 'mindicador:dolar'));
    assert.equal(quotes.length, 10);
  });

  test('UF → CLF y euro → EUR', async () => {
    const { fn, calls } = fakeFetch(async (url) => new Response(await fixture(url.includes('/uf/') ? 'uf-2026.json' : 'euro-2025.json')));
    const provider = new MindicadorFxRateProvider({ fetch: fn });
    const uf = await provider.fetchYear('CLF', 2026);
    const euro = await provider.fetchYear('EUR', 2025);
    assert.deepEqual(calls, ['https://mindicador.cl/api/uf/2026', 'https://mindicador.cl/api/euro/2025']);
    assert.equal(uf.find((q) => q.date === '2026-06-15')?.rate.toString(), '40779.55');
    assert.equal(uf[0]!.source, 'mindicador:uf');
    assert.equal(euro.find((q) => q.date === '2025-07-01')?.rate.toString(), '1099.05');
  });

  test('una fecha en horario de invierno a las 04:00Z no se confunde con el día anterior', async () => {
    const body = JSON.stringify({ codigo: 'dolar', serie: [{ fecha: '2025-06-02T04:00:00.000Z', valor: 940.1 }, { fecha: '2025-01-02T03:00:00.000Z', valor: 996.46 }] });
    const { fn } = fakeFetch(async () => new Response(body));
    const quotes = await new MindicadorFxRateProvider({ fetch: fn }).fetchYear('USD', 2025);
    assert.deepEqual(quotes.map((q) => [q.date, q.rate.toString()]), [['2025-06-02', '940.1'], ['2025-01-02', '996.46']]);
  });

  for (const [name, response] of [
    ['HTTP 500', () => new Response('error', { status: 500 })],
    ['JSON inválido', () => new Response('<html>')],
    ['sin serie', () => new Response(JSON.stringify({ codigo: 'dolar' }))],
    ['indicador distinto', () => new Response(JSON.stringify({ codigo: 'euro', serie: [] }))],
    ['valor no numérico', () => new Response(JSON.stringify({ codigo: 'dolar', serie: [{ fecha: '2025-01-02T03:00:00.000Z', valor: 'x' }] }))],
    ['valor no positivo', () => new Response(JSON.stringify({ codigo: 'dolar', serie: [{ fecha: '2025-01-02T03:00:00.000Z', valor: 0 }] }))],
    ['fecha inválida', () => new Response(JSON.stringify({ codigo: 'dolar', serie: [{ fecha: 'ayer', valor: 900 }] }))],
  ] as const) {
    test(`falla con un error claro si la respuesta es mala: ${name}`, async () => {
      const { fn } = fakeFetch(async () => response());
      await assert.rejects(new MindicadorFxRateProvider({ fetch: fn }).fetchYear('USD', 2025), /mindicador/);
    });
  }

  test('respeta el timeout (aborta la petición)', async () => {
    const { fn } = fakeFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );
    await assert.rejects(new MindicadorFxRateProvider({ fetch: fn, timeoutMs: 20 }).fetchYear('USD', 2025), /mindicador/);
  });
});
