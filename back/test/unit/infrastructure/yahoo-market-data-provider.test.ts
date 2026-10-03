import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { UnknownPriceSymbolError } from '../../../src/application/ports/market-data-provider.ts';
import { float32ToDecimal, YahooMarketDataProvider } from '../../../src/infrastructure/market/yahoo-market-data-provider.ts';

// Respuestas reales de Yahoo (chart v8) grabadas; los tests nunca llaman a internet.
const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'yahoo');
const fixture = (name: string) => readFile(join(FIXTURES, name), 'utf8');

function provider(handler: (url: string, init?: RequestInit) => Promise<Response>, sleeps: number[] = []) {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return handler(String(input), init);
  }) as typeof fetch;
  const p = new YahooMarketDataProvider({
    fetch: fetchFn,
    now: () => new Date('2026-10-03T15:00:00Z'),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { p, calls, sleeps };
}

describe('float32ToDecimal: el decimal más corto que reproduce el mismo float32', () => {
  for (const [input, expected] of [
    [86.0999984741211, '86.1'],
    [86.08000183105469, '86.08'],
    [2183.56005859375, '2183.56'],
    [85.6500015258789, '85.65'],
    [2600, '2600'],
    [0.1, '0.1'],
    [123456.78125, '123456.78'],
    [16777217, '16777216'],
    [1e-7, '0.0000001'],
    [0.000123456789, '0.00012345679'],
    [2160.072, '2160.072'],
  ] as const) {
    test(`${input} → ${expected}`, () => assert.equal(float32ToDecimal(input).toString(), expected));
  }

  test('es determinista: el resultado pasado por fround vuelve al mismo float32', () => {
    for (const x of [86.0999984741211, 2183.56005859375, 13.37, 999999.9, 0.30000001192092896]) {
      const d = float32ToDecimal(x);
      assert.equal(Math.fround(Number(d.toString())), Math.fround(x));
    }
  });
});

describe('YahooMarketDataProvider', () => {
  test('pide chart v8 diario con período, User-Agent y parsea cierres en la fecha de la bolsa', async () => {
    const { p, calls } = provider(async () => new Response(await fixture('KO.json')));
    const chart = await p.fetchChart('KO', '2026-07-01');

    assert.equal(calls.length, 1);
    const url = new URL(calls[0]!.url);
    assert.equal(url.origin + url.pathname, 'https://query1.finance.yahoo.com/v8/finance/chart/KO');
    assert.equal(url.searchParams.get('interval'), '1d');
    assert.equal(url.searchParams.get('period1'), String(Date.UTC(2026, 6, 1) / 1000));
    assert.ok(Number(url.searchParams.get('period2')) >= Date.UTC(2026, 9, 3, 15) / 1000);
    assert.match(calls[0]!.headers.get('user-agent') ?? '', /crescendo/i);

    assert.equal(chart.currency, 'USD');
    assert.equal(chart.priceSymbol, 'KO');
    const last = chart.closes.at(-1)!;
    assert.deepEqual([last.date, last.close.toString()], ['2026-10-02', '85.65']);
    assert.equal(chart.closes.find((c) => c.date === '2026-10-01')?.close.toString(), '86.1');
    // La cotización viene del meta; la variación usa el último cierre ANTERIOR a su fecha (no chartPreviousClose).
    assert.deepEqual(
      [chart.quote?.price.toString(), chart.quote?.date, chart.quote?.previousClose?.toString(), chart.quote?.asOf.toISOString()],
      ['85.65', '2026-10-02', '86.1', '2026-10-02T20:00:02.000Z'],
    );
  });

  test('Santiago: fechas en zona de Chile; el cierre null no se inventa y la cotización sale del meta', async () => {
    const { p } = provider(async () => new Response(await fixture('CFINRENTAS.SN.json')));
    const chart = await p.fetchChart('CFINRENTAS.SN', '2026-07-01');
    assert.equal(chart.currency, 'CLP');
    assert.ok(!chart.closes.some((c) => c.date === '2026-10-02'), 'la barra con close null se omite');
    assert.equal(chart.closes.at(-1)!.close.toString(), '2183.56');
    assert.deepEqual([chart.quote?.price.toString(), chart.quote?.date, chart.quote?.previousClose?.toString()], ['2160.072', '2026-10-02', '2183.56']);
    // Barra de las 13:30Z en julio (UTC−4) = 09:30 del mismo día en Chile.
    assert.equal(chart.closes[0]!.date, '2026-07-02');
  });

  test('PEHUENCHE: precio del meta distinto del último cierre se respeta', async () => {
    const { p } = provider(async () => new Response(await fixture('PEHUENCHE.SN.json')));
    const chart = await p.fetchChart('PEHUENCHE.SN', '2026-07-01');
    assert.equal(chart.quote?.price.toString(), '2701');
  });

  test('símbolo inexistente (404) → UnknownPriceSymbolError, sin reintentos', async () => {
    const { p, calls } = provider(async () => new Response(await fixture('not-found.json'), { status: 404 }));
    await assert.rejects(p.fetchChart('NOEXISTE.SN', '2026-07-01'), UnknownPriceSymbolError);
    assert.equal(calls.length, 1);
  });

  test('429 y 5xx: reintenta con backoff exponencial y luego responde', async () => {
    let n = 0;
    const { p, calls, sleeps } = provider(async () => {
      n += 1;
      if (n === 1) return new Response('Too Many Requests', { status: 429 });
      if (n === 2) return new Response('Bad Gateway', { status: 502 });
      return new Response(await fixture('KO.json'));
    });
    const chart = await p.fetchChart('KO', '2026-07-01');
    assert.equal(chart.closes.length > 0, true);
    assert.equal(calls.length, 3);
    assert.deepEqual(sleeps, [1000, 2000]);
  });

  test('429 persistente: se rinde tras los reintentos con un error claro', async () => {
    const { p, calls } = provider(async () => new Response('Too Many Requests', { status: 429 }));
    await assert.rejects(p.fetchChart('KO', '2026-07-01'), /yahoo KO: HTTP 429/);
    assert.equal(calls.length, 4);
  });

  for (const [name, body] of [
    ['JSON inválido', '<html>'],
    ['sin result', JSON.stringify({ chart: { result: null, error: null } })],
    ['timestamps y closes de distinto largo', JSON.stringify({ chart: { result: [{ meta: { currency: 'USD', exchangeTimezoneName: 'America/New_York', symbol: 'KO' }, timestamp: [1, 2], indicators: { quote: [{ close: [1] }] } }] } })],
  ] as const) {
    test(`respuesta mala: ${name} → error claro`, async () => {
      const { p } = provider(async () => new Response(body));
      await assert.rejects(p.fetchChart('KO', '2026-07-01'), /yahoo KO/);
    });
  }

  test('timeout aborta la petición', async () => {
    const fetchFn = ((_u: string, init?: RequestInit) =>
      new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as typeof fetch;
    const p = new YahooMarketDataProvider({ fetch: fetchFn, timeoutMs: 20, retries: 0, sleep: async () => {} });
    await assert.rejects(p.fetchChart('KO', '2026-07-01'), /yahoo KO/);
  });
});
